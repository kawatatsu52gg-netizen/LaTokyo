# Square → Meta CAPI Worker

Square の予約 (`booking.created`) を受けて、**Meta Conversions API (CAPI)** に
`Purchase` コンバージョンイベントを送る Cloudflare Worker です。

飛び先が Square 直で `fbclid` が拾えないため、マッチングは
**email / 電話番号のハッシュ（アドバンスドマッチング）** で行います。

- 本体: [`src/index.js`](src/index.js)
- 設定: [`wrangler.toml`](wrangler.toml)

---

## 動作の流れ

```
Meta広告 → Square予約完了 → Square Webhook(booking.created)
        → この Worker → 署名検証 → Square Customers APIで連絡先取得
        → email/電話をSHA-256ハッシュ → Meta CAPI に Purchase送信
```

- `POST` 以外は `405`
- Square 署名（`x-square-hmacsha256-signature`）を検証。不一致は `401`
- `booking.created` 以外は `200` で無視（Square にリトライさせない）
- 連絡先取得と CAPI 送信は `ctx.waitUntil()` に逃がし、Square には即 `200`
- `event_id = booking.id` で重複排除（同じ予約を2回受けても二重計上されない）

---

## 必要なもの

- Node.js 18+（推奨 20/22）
- Cloudflare アカウント + `wrangler`（`npx wrangler` でも可）
- Square / Meta の各シークレット（下記）

---

## セットアップ

```bash
# 依存インストール
npm install

# Cloudflare にログイン（ブラウザが開きます）
npx wrangler login
```

### ローカル開発（任意）

```bash
cp .dev.vars.example .dev.vars   # 値を埋める（.dev.vars は gitignore 済み）
npm run dev
```

---

## デプロイ手順

### 1. まずデプロイして公開 URL を得る

```bash
npm run deploy
# 出力例:
#   https://square-to-meta-capi-worker.<your-subdomain>.workers.dev
```

この URL を控えます（= `SQUARE_NOTIFICATION_URL`）。
**署名検証はこの URL の完全一致が必要**なので、末尾スラッシュの有無まで正確に。

### 2. シークレットを登録

各コマンドを実行すると値の入力を求められます（値は端末に残りません）。

```bash
npx wrangler secret put META_PIXEL_ID
npx wrangler secret put META_CAPI_TOKEN
npx wrangler secret put SQUARE_ACCESS_TOKEN
npx wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY
npx wrangler secret put SQUARE_NOTIFICATION_URL   # ← 1 で控えた公開 URL

# テスト時のみ（本番化時に削除）
npx wrangler secret put META_TEST_EVENT_CODE
```

### 3. 再デプロイ（シークレット反映）

```bash
npm run deploy
```

---

## シークレット一覧と取得先

| 変数名 | 用途 | 取得元（手作業） |
|---|---|---|
| `META_PIXEL_ID` | データセットID | Meta Events Manager |
| `META_CAPI_TOKEN` | CAPIアクセストークン | Meta Events Manager → 設定 → Conversions API |
| `SQUARE_ACCESS_TOKEN` | 顧客情報取得 | Square Developer Dashboard |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | 署名検証 | Square Webhooks 設定 |
| `SQUARE_NOTIFICATION_URL` | 署名検証で完全一致が必要 | デプロイ後の Worker URL |
| `META_TEST_EVENT_CODE` | テスト時のみ | Meta テストイベント画面 |

### 具体的な取得画面

- **META_PIXEL_ID / META_CAPI_TOKEN**
  Meta Events Manager → 対象のデータセットを選択 → 「設定」 →
  「Conversions API」→「アクセストークンを生成」。ピクセル(データセット)ID は
  同ページ上部に表示。
- **META_TEST_EVENT_CODE**
  Events Manager → データセット →「テストイベント」タブ →
  表示される `TEST#####` のコード。
- **SQUARE_ACCESS_TOKEN**
  Square Developer Dashboard → 対象アプリ → 「Credentials」。
  本番連携なら **Production Access Token**（サンドボックス検証時は Sandbox）。
- **SQUARE_WEBHOOK_SIGNATURE_KEY**
  Square Developer Dashboard → アプリ → 「Webhooks」→ 対象 subscription の
  **Signature Key**。

---

## Square Webhook Subscription の作成

通知先 = デプロイした Worker の URL、イベント = `booking.created`。

### 方法A: ダッシュボード（推奨・確実）

1. [Square Developer Dashboard](https://developer.squareup.com/apps) → 対象アプリ
2. 左メニュー **Webhooks** → **Subscriptions** → **Add Endpoint**
3. **URL** に Worker の公開 URL を入力
4. **API version** を選択（本Workerは `2025-06-18` 想定。差異があれば
   `src/index.js` の `SQUARE_VERSION` を合わせる）
5. **Events** で `booking.created` にチェック
6. 保存 → 表示される **Signature Key** を控え、
   `SQUARE_WEBHOOK_SIGNATURE_KEY` に登録
7. 「**Send test event**」で疎通確認（署名検証が通り 200 が返ることを確認）

### 方法B: API（curl）

`WEBHOOK_SUBSCRIPTIONS` 権限のあるトークンが必要です。

```bash
curl https://connect.squareup.com/v2/webhooks/subscriptions \
  -X POST \
  -H "Square-Version: 2025-06-18" \
  -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "'"$(uuidgen)"'",
    "subscription": {
      "name": "booking-created-to-meta-capi",
      "event_types": ["booking.created"],
      "notification_url": "https://square-to-meta-capi-worker.<your-subdomain>.workers.dev",
      "api_version": "2025-06-18"
    }
  }'
```

レスポンスの `subscription.signature_key` を
`SQUARE_WEBHOOK_SIGNATURE_KEY` に登録してください。

---

## テスト手順

1. `META_TEST_EVENT_CODE` を登録した状態でデプロイ（上記デプロイ手順）
2. 別ターミナルでログを追う:
   ```bash
   npm run tail
   ```
3. Square で **本物のテスト予約を1件作成**（メール/電話が埋まっている顧客で）
4. `wrangler tail` のログで CAPI レスポンスを確認 →
   `events_received: 1` を期待
5. **Meta Events Manager →「テストイベント」** に `Purchase` が表示されることを確認
6. 確認できたら本番化:
   ```bash
   npx wrangler secret delete META_TEST_EVENT_CODE
   npm run deploy
   ```

### 署名検証（401）のローカル確認

不正署名が弾かれることは `wrangler dev` + curl で確認できます:

```bash
# 署名ヘッダ無し / 不正 → 401 になること
curl -i -X POST http://127.0.0.1:8787/ \
  -H "Content-Type: application/json" \
  -H "x-square-hmacsha256-signature: invalid" \
  -d '{"type":"booking.created","data":{"object":{"booking":{"id":"test"}}}}'
```

---

## トラブルシュート

| 症状 | 原因 / 対処 |
|---|---|
| **401 Unauthorized が返る** | `SQUARE_NOTIFICATION_URL` が実際の受信 URL と**完全一致**していない（末尾スラッシュ / http・https / サブドメイン）。Square 側の subscription URL と登録シークレットを一致させる。`SQUARE_WEBHOOK_SIGNATURE_KEY` の取り違えにも注意。 |
| **ログに `skip (unmatchable)`** | 顧客に email も電話も無い。連絡先が入る顧客で予約する。 |
| **ログに `customer ... not fetched`** | `SQUARE_ACCESS_TOKEN` の権限/環境（本番/サンドボックス）不一致、または `customer_id` が存在しない。 |
| **`events_received: 0` / エラー返却** | `META_PIXEL_ID` / `META_CAPI_TOKEN` の誤り、トークン失効。Meta のレスポンス本文をログで確認。 |
| **テストイベントに出ない** | `META_TEST_EVENT_CODE` 未設定 or 値違い。Events Manager のテストイベント画面のコードと一致させて再デプロイ。 |
| **同じ予約が二重計上される** | 通常は `event_id = booking.id` で排除される。別イベント種別で重複送信していないか確認。 |
| **`booking.created` が届かない** | Square subscription のイベント種別 / URL / 有効化状態を確認。ダッシュボードの Send test event で疎通確認。 |

### 再デプロイ

コードやシークレットを変更したら:

```bash
npm run deploy
```

シークレットの一覧確認 / 削除:

```bash
npx wrangler secret list
npx wrangler secret delete <NAME>
```

---

## 初回(新規獲得)メニューだけをコンバージョン計上する

回数券などリピート客の予約まで Purchase として送ると、広告の新規獲得最適化が
ズレる。これを防ぐため、**特定のサービス(メニュー)の予約だけ**を送信対象にできる。

- 送信対象にしたいメニューの `service_variation_id` を
  `CONVERSION_SERVICE_VARIATION_IDS`（カンマ区切り）に設定する。
- 設定されていると、予約の `service_variation_id` が一致したときだけ CAPI 送信。
  一致しない予約（回数券など）は `skip (repeat/other menu)` としてスキップ。
- **未設定の場合は全予約を送信**し、`WARN CONVERSION_SERVICE_VARIATION_IDS not set`
  を警告ログに出す。

### 対象メニューの service_variation_id を調べる

1. 対象メニュー（例: 初回体験）で予約を1件作成する
2. Worker のログ（ダッシュボード Observability / `wrangler tail`）で
   `booking ...: service_variation_ids=[...]` の行を見る
3. その ID を設定に登録:
   ```bash
   npx wrangler secret put CONVERSION_SERVICE_VARIATION_IDS
   # 値の例（複数はカンマ区切り）: ABCD1234,EFGH5678
   npm run deploy
   ```

## カスタマイズ

- **イベント名**: `src/index.js` の `EVENT_NAME`（`"Purchase"` → `"Schedule"` 等）
- **金額(value)**: `getValueForBooking(booking)` を編集してメニュー別単価に拡張
- **初回メニュー絞り込み**: `CONVERSION_SERVICE_VARIATION_IDS`（上記）
- **API バージョン**: `SQUARE_VERSION` / `META_GRAPH_VERSION`

---

## セキュリティ / 秘密情報の扱い

- シークレットは **`wrangler secret`** と **`.dev.vars`（gitignore済み）** のみ。
  コードや git に平文で残さない。
- 平文の PII（email/電話/氏名）は**ログに出力しない**。ハッシュ化した値のみ Meta に送る。
- `.dev.vars` は `.gitignore` 済み。誤ってコミットしていないか
  `git status` で確認すること。
