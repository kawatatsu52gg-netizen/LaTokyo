/**
 * Util.gs
 * 共通ユーティリティ。
 * 実データが非常にバラついている（列ズレ・表記ゆれ・混在）ため、
 * 決め打ちせず「見出しで探す」「行を丸ごと走査する」ための道具を置く。
 */

/** 全角→半角・空白/記号除去して比較しやすくする（見出し照合用）。 */
function normKey_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  // 全角英数記号を半角へ
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
  // 空白（全角スペース含む）を除去、記号の一部を除去
  s = s.replace(/[\s　]+/g, '');
  return s.toLowerCase();
}

/**
 * セルを金額として解釈する。解釈できなければ null。
 * - "¥51,000" / "57,000" / "28500" → 数値
 * - "4/7" / "3/21" / "1/6"（日付・回数券進捗） → null（除外）
 * - 名前や説明文 → null
 */
function parseAmount_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v).trim();
  if (s === '') return null;
  // 日付/分数っぽいもの（スラッシュ・ハイフンを含む）は金額とみなさない
  if (/[\/／]/.test(s)) return null;
  // ¥, 円, カンマ, 空白を除去
  var cleaned = s.replace(/[¥￥,，\s　円]/g, '');
  // マイナス表記（"ー86000" など）も一応対応
  cleaned = cleaned.replace(/^[−ー–—]/, '-');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  var n = Number(cleaned);
  return isFinite(n) ? n : null;
}

/**
 * 顧客ルートの表記ゆれをざっくり正規化して固定リストの値に寄せる。
 * 既知ルートに該当しなければ null（＝ルートではないセル、として扱う）。
 */
function normalizeRoute_(v) {
  if (v === null || v === undefined) return null;
  var s = String(v).trim();
  if (s === '') return null;
  var k = normKey_(s);

  // Meta広告
  if (/(^|[^a-z])meta([^a-z]|$)/.test(k) || k.indexOf('メタ') >= 0 || k.indexOf('metaad') >= 0 ||
      k.indexOf('meta広告') >= 0 || k === 'meta') return 'Meta広告';
  // Instagram / インスタ
  if (k.indexOf('instagram') >= 0 || k.indexOf('insta') >= 0 || k.indexOf('インスタ') >= 0 ||
      k === 'ig') return 'Instagram';
  // Threads（"Theads" 等の誤記も吸収）
  if (k.indexOf('thread') >= 0 || k.indexOf('theads') >= 0 || k.indexOf('スレッズ') >= 0) return 'Threads';
  // HotPepper（HPB / HP / ホットペッパー）
  if (k.indexOf('hotpepper') >= 0 || k === 'hpb' || k === 'hp' || k.indexOf('ホットペッパー') >= 0 ||
      k.indexOf('ペッパー') >= 0) return 'HotPepper';
  // 紹介
  if (k.indexOf('紹介') >= 0) return '紹介';
  // 知人（友達・先輩・後輩・知り合い・彼氏/彼女の友達など人づて）
  if (k.indexOf('知人') >= 0 || k.indexOf('知り合い') >= 0 || k === '友達' || k === '友人' ||
      k === '先輩' || k === '後輩' || k === '弟' || k === '妹' || k === '兄' || k === '姉') return '知人';
  // その他（明示）
  if (k === 'その他' || k === 'モデル') return 'その他';

  return null; // 既知ルートに該当せず
}

/** "2026/01" 形式の月キーを作る。 */
function monthKey_(year, month) {
  var mm = ('0' + month).slice(-2);
  return year + '/' + mm;
}

/**
 * 文字列から年月を推定して "YYYY/MM" を返す。取れなければ null。
 * 受け付ける例: "2026.01", "２０２５．10", "2025/10", "2026年1月", "2026/1", Dateオブジェクト
 */
function detectMonthKey_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return monthKey_(v.getFullYear(), v.getMonth() + 1);
  }
  var s = normKey_(v); // 全角英数→半角化済み
  // 全角の区切り記号も半角へ寄せる（例: "２０２５．10" → "2025.10"）
  s = s.replace(/[．。]/g, '.').replace(/／/g, '/');
  var m;
  // 2026年1月
  m = s.match(/(\d{4})年(\d{1,2})月/);
  if (m) return monthKey_(m[1], Number(m[2]));
  // 2026.01 / 2025/10 / 2026-1
  m = s.match(/(\d{4})[.\/\-](\d{1,2})/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return monthKey_(m[1], Number(m[2]));
  return null;
}

/**
 * 2次元配列 rows の中から、col列(0始まり)の正規化値が
 * pred(normalizedKey) を満たす最初の行インデックスを返す。無ければ -1。
 */
function findRowIndex_(rows, col, pred) {
  for (var r = 0; r < rows.length; r++) {
    var cell = rows[r][col];
    if (cell === undefined) continue;
    if (pred(normKey_(cell))) return r;
  }
  return -1;
}

/** ゼロ割ガード。分母が0/空なら null を返す。 */
function safeDiv_(num, den) {
  if (!den || den === 0) return null;
  return num / den;
}
