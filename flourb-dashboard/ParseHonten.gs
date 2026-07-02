/**
 * ParseHonten.gs
 * 本体売上「ハーブピーリング2026」パーサ（日報グリッド型・読み取り専用）。
 *
 * 構造:
 *   - 月ごとにタブ（例: "2026.01"）
 *   - 1行目に日付ヘッダー、右端に「合計」列
 *   - 左端(A列)に項目見出し。行位置は固定ではないため見出し文字で探す。
 *
 * 取得:
 *   - 「売上」行（実データは "売上　　10階"）の合計 → 本体売上
 *   - 「新規客数」行の合計 → 新規数
 *   - 「meta」行の合計 → Meta経由の新規“件数”（売上は紐づかないため件数のみ）
 *
 * 返り値: { "YYYY/MM": { honten:Number, shinki:Number, metaCount:Number } }
 */
function parseHonten_() {
  var result = {};
  var ss = SpreadsheetApp.openById(CONFIG.SOURCES.HONTEN);
  var sheets = ss.getSheets();

  sheets.forEach(function (sheet) {
    var name = sheet.getName();
    var mKey = detectMonthKey_(name);
    if (!mKey) return; // 月タブでなければスキップ

    var values = sheet.getDataRange().getValues();
    if (!values.length) return;

    // 「合計」列を探す（最初の数行のどこかにある想定。まず1行目、無ければ全体走査）。
    var totalCol = findTotalCol_(values);
    if (totalCol < 0) return;

    // 各項目行を A列(0)の正規化見出しで探す
    var salesRow = findRowIndex_(values, 0, function (k) {
      // "売上　　10階" のように "売上" で始まる最初の行（現金売上/クレジット売上を除外）
      return k.indexOf('売上') === 0;
    });
    var shinkiRow = findRowIndex_(values, 0, function (k) { return k === '新規客数'; });
    var metaRow = findRowIndex_(values, 0, function (k) { return k === 'meta'; });

    result[mKey] = {
      honten: readTotal_(values, salesRow, totalCol),
      shinki: readTotal_(values, shinkiRow, totalCol),
      metaCount: readTotal_(values, metaRow, totalCol)
    };
  });

  return result;
}

/** 「合計」というセルの列インデックスを返す。最初に見つかったものを採用。 */
function findTotalCol_(values) {
  var scan = Math.min(values.length, 5); // 上部数行を見る
  for (var r = 0; r < scan; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (normKey_(values[r][c]) === '合計') return c;
    }
  }
  return -1;
}

/** 指定行・合計列の値を金額/数値として読む。行が無ければ0。 */
function readTotal_(values, rowIdx, totalCol) {
  if (rowIdx < 0) return 0;
  var v = values[rowIdx][totalCol];
  var n = parseAmount_(v);
  return n === null ? 0 : n;
}
