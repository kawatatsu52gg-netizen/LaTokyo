/**
 * Square (booking.created) -> Meta Conversions API (CAPI) bridge Worker
 *
 * 目的:
 *   「Meta広告 -> Square直」で予約が完結し Meta にコンバージョンが返らない問題を、
 *   Square の booking.created Webhook を受けてサーバーサイドで Meta CAPI に
 *   Purchase イベントを送ることで解消する。
 *
 * マッチング:
 *   飛び先が Square 直で fbclid が拾えないため、email/電話のハッシュ
 *   （アドバンスドマッチング）で行う。
 *
 * 秘密情報はすべて wrangler secret / .dev.vars で注入する（ハードコード禁止）。
 */

// 送信イベント名。予約導線を「購入」ではなく「予約(Schedule)」として扱いたい場合は
// "Schedule" に切り替える。Meta 側の標準イベント名に一致させること。
const EVENT_NAME = "Purchase";

// Square / Meta の API バージョン
const SQUARE_VERSION = "2025-06-18";
const META_GRAPH_VERSION = "v21.0";

export default {
  async fetch(request, env, ctx) {
    // 1) POST のみ受け付ける
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // 2) raw text で本文を取得（署名検証はバイト列一致が必要なので parse 前に取る）
    const rawBody = await request.text();
    const signature = request.headers.get("x-square-hmacsha256-signature") || "";

    // 3) Square 署名検証
    //    期待値 = base64( HMAC-SHA256( SQUARE_NOTIFICATION_URL + rawBody, KEY ) )
    const valid = await verifySquareSignature(
      env.SQUARE_NOTIFICATION_URL,
      rawBody,
      env.SQUARE_WEBHOOK_SIGNATURE_KEY,
      signature
    );
    if (!valid) {
      console.error("Signature verification failed");
      return new Response("Unauthorized", { status: 401 });
    }

    // 4) パース。壊れた JSON は 200 で無視（リトライさせない）
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (e) {
      console.error("Invalid JSON body:", e && e.message);
      return new Response("OK", { status: 200 });
    }

    // 5) booking.created 以外は 200 で無視（Square にリトライさせない）
    if (!event || event.type !== "booking.created") {
      return new Response("OK", { status: 200 });
    }

    const booking = event?.data?.object?.booking;
    if (!booking) {
      console.error("No booking object in payload; event id:", event?.event_id);
      return new Response("OK", { status: 200 });
    }

    // 6) 重い処理（顧客取得・CAPI送信）は waitUntil に逃がして即 200 を返す
    ctx.waitUntil(
      processBooking(booking, env).catch((e) => {
        console.error("processBooking error:", e && (e.stack || e.message || e));
      })
    );

    return new Response("OK", { status: 200 });
  },
};

/**
 * booking を処理して Meta CAPI に送る。
 */
async function processBooking(booking, env) {
  const bookingId = booking.id;
  const customerId = booking.customer_id;

  // --- メニュー(サービス)による絞り込み ---
  // 「初回」など新規獲得に該当するサービスの予約だけをコンバージョンとして送る。
  // 回数券など既存客(リピート)の予約は除外する（広告最適化を新規獲得に合わせるため）。
  // 対象サービスの service_variation_id を CONVERSION_SERVICE_VARIATION_IDS
  // （カンマ区切り）で指定する。未設定のときは全件送信し、警告ログを出す。
  const serviceVariationIds = extractServiceVariationIds(booking);
  console.log(
    `booking ${bookingId}: service_variation_ids=${JSON.stringify(serviceVariationIds)}`
  );

  const allowRaw = (env.CONVERSION_SERVICE_VARIATION_IDS || "").trim();
  if (allowRaw) {
    const allow = new Set(
      allowRaw.split(",").map((s) => s.trim()).filter(Boolean)
    );
    const isConversion = serviceVariationIds.some((id) => allow.has(id));
    if (!isConversion) {
      console.log(
        `booking ${bookingId}: not a conversion (first-time) service, skip (repeat/other menu)`
      );
      return;
    }
  } else {
    console.log(
      `booking ${bookingId}: WARN CONVERSION_SERVICE_VARIATION_IDS not set — sending ALL bookings (no first-time filter)`
    );
  }

  if (!customerId) {
    console.log(`booking ${bookingId}: no customer_id, skip (cannot match)`);
    return;
  }

  // Square Customers API で連絡先を取得（Webhook 本体には連絡先が入っていない）
  console.log(`processBooking start booking=${bookingId} customer=${customerId}`);

  const customer = await fetchSquareCustomer(customerId, env);
  if (!customer) {
    console.log(`booking ${bookingId}: customer ${customerId} not fetched, skip`);
    return;
  }

  const email = (customer.email_address || "").trim().toLowerCase();
  const rawPhone = customer.phone_number || "";
  const givenName = (customer.given_name || "").trim().toLowerCase();
  const familyName = (customer.family_name || "").trim().toLowerCase();
  const normalizedPhone = normalizeJpPhone(rawPhone);

  // email も phone も無ければマッチ不能 -> 送信しない
  if (!email && !normalizedPhone) {
    console.log(`booking ${bookingId}: no email/phone on customer, skip (unmatchable)`);
    return;
  }

  // 7) PII をハッシュ化して user_data を組む（平文はログ/送信に載せない）
  const user_data = {};
  if (email) user_data.em = [await sha256Hex(email)];
  if (normalizedPhone) user_data.ph = [await sha256Hex(normalizedPhone)];
  if (givenName) user_data.fn = [await sha256Hex(givenName)];
  if (familyName) user_data.ln = [await sha256Hex(familyName)];

  // PII は出さず、どのフィールドが揃ったかだけ記録（マッチ状況の確認用）
  console.log(
    `booking ${bookingId}: matched em=${!!email} ph=${!!normalizedPhone} fn=${!!givenName} ln=${!!familyName}`
  );

  const eventTime = toUnixSeconds(booking.created_at);

  const eventPayload = {
    event_name: EVENT_NAME,
    event_time: eventTime,
    action_source: "website",
    event_id: bookingId, // 重複排除キー（同一 booking を2回受けても二重計上されない）
    user_data,
    custom_data: {
      currency: "JPY",
      value: getValueForBooking(booking),
    },
  };

  const body = { data: [eventPayload] };

  // テスト時のみ test_event_code を含める（本番では未設定）
  if (env.META_TEST_EVENT_CODE) {
    body.test_event_code = env.META_TEST_EVENT_CODE;
  }

  const url =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${env.META_PIXEL_ID}/events` +
    `?access_token=${encodeURIComponent(env.META_CAPI_TOKEN)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  // 平文 PII は出さない。ステータス・Meta レスポンス（events_received 等）のみ。
  console.log(
    `CAPI sent booking=${bookingId} status=${res.status} response=${text}`
  );

  if (!res.ok) {
    console.error(`CAPI non-2xx for booking=${bookingId}: ${res.status} ${text}`);
  }
}

/**
 * Square Customers API から顧客を取得。
 */
async function fetchSquareCustomer(customerId, env) {
  const url = `https://connect.squareup.com/v2/customers/${encodeURIComponent(customerId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Square customer fetch failed: ${res.status} ${text}`);
    return null;
  }

  const json = await res.json();
  return json.customer || null;
}

/**
 * Square 署名検証（タイミングセーフ比較）。
 * 期待値 = base64( HMAC-SHA256( notificationUrl + rawBody, signatureKey ) )
 */
async function verifySquareSignature(notificationUrl, rawBody, signatureKey, provided) {
  if (!notificationUrl || !signatureKey || !provided) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const macBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(notificationUrl + rawBody)
  );
  const expected = base64FromArrayBuffer(macBuffer);

  return timingSafeEqual(expected, provided);
}

/**
 * 長さリークを避けつつ定数時間比較する。
 */
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

/**
 * ArrayBuffer -> base64
 */
function base64FromArrayBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 文字列を SHA-256 hex に。呼び出し側で小文字・トリム済みを渡す前提。
 */
async function sha256Hex(input) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * 日本向け電話番号の正規化。
 *   数字のみ抽出 -> 先頭 0 を国番号 81 に置換。
 *   例: "090-1234-5678" -> "819012345678"
 * すでに 81 始まりのものはそのまま。
 */
function normalizeJpPhone(raw) {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) {
    digits = "81" + digits.slice(1);
  }
  return digits;
}

/**
 * ISO8601 文字列を UNIX 秒に。無効/未設定なら現在時刻。
 */
function toUnixSeconds(iso) {
  if (iso) {
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return Math.floor(t / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

/**
 * 予約に紐づくサービス(メニュー)の service_variation_id をすべて取り出す。
 * booking.appointment_segments[].service_variation_id を配列で返す。
 */
function extractServiceVariationIds(booking) {
  const segments = Array.isArray(booking.appointment_segments)
    ? booking.appointment_segments
    : [];
  return segments
    .map((seg) => seg && seg.service_variation_id)
    .filter(Boolean);
}

/**
 * 予約の金額（value）を返す。
 * 既定は 12000 JPY。今後メニュー/サービス別に分岐して拡張する。
 * 例: extractServiceVariationIds(booking) の ID で単価を切り替える。
 */
function getValueForBooking(booking) {
  // TODO: メニュー別の単価に拡張する場合はここで booking の内容から算出する。
  return 12000;
}
