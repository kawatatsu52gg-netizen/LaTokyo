/**
 * Dashboard.gs
 * 集計結果を新しいダッシュボード用スプレッドシートに書き出す。
 * 既存の売上シートには一切書き込まない。
 *
 * 列: 月 | 本体売上 | 蘭ちゃん売上 | みやちゃん売上 | 売上合計 |
 *     新規数 | Meta新規数 | Meta売上 | 広告費 | CPA | ROAS
 */

var DASHBOARD_HEADERS = [
  '月', '本体売上', '蘭ちゃん売上', 'みやちゃん売上', '売上合計',
  '新規数', 'Meta新規数', 'Meta売上', '広告費', 'CPA', 'ROAS'
];

/** ダッシュボード用スプレッドシートを取得（無ければ作成してIDを保存）。 */
function getDashboardSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(CONFIG.DASHBOARD_PROPERTY);
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      Logger.log('保存済みダッシュボードIDが開けないため新規作成します: ' + e);
    }
  }
  var ss = SpreadsheetApp.create(CONFIG.DASHBOARD_TITLE);
  props.setProperty(CONFIG.DASHBOARD_PROPERTY, ss.getId());
  Logger.log('ダッシュボードを新規作成しました: ' + ss.getUrl());
  return ss;
}

/**
 * 集計済みデータ(rowsByMonth)をダッシュボードタブに書き出す。
 * rowsByMonth: 配列。各要素 {
 *   month, honten, ran, miya, salesTotal, shinki, metaCount,
 *   metaSalesActual, metaSalesEstimate, metaSales, spend, cpa, roas
 * }
 */
function writeDashboard_(rowsByMonth) {
  var ss = getDashboardSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.DASHBOARD_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.DASHBOARD_SHEET_NAME, 0);
  }
  sheet.clear();
  sheet.clearNotes();

  // ヘッダー
  var out = [DASHBOARD_HEADERS];
  rowsByMonth.forEach(function (r) {
    out.push([
      r.month,
      r.honten,
      r.ran,
      r.miya,
      r.salesTotal,
      r.shinki,
      r.metaCount,
      r.metaSales,
      (r.spend === null || r.spend === undefined) ? '-' : r.spend,
      (r.cpa === null || r.cpa === undefined) ? '-' : Math.round(r.cpa),
      (r.roas === null || r.roas === undefined) ? '-' : Math.round(r.roas * 100) / 100
    ]);
  });

  sheet.getRange(1, 1, out.length, DASHBOARD_HEADERS.length).setValues(out);

  // Meta売上セルに「実額＋概算」の内訳メモを付与
  var metaSalesCol = DASHBOARD_HEADERS.indexOf('Meta売上') + 1;
  rowsByMonth.forEach(function (r, idx) {
    var note = 'Meta売上 内訳\n'
      + '実額(蘭+みや): ' + yen_(r.metaSalesActual) + '\n'
      + '本体概算(meta件数×客単価): ' + yen_(r.metaSalesEstimate);
    sheet.getRange(idx + 2, metaSalesCol).setNote(note);
  });

  // 体裁: 太字ヘッダー・通貨/数値フォーマット・列幅
  formatDashboard_(sheet, out.length);

  // 更新時刻メモ
  var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  sheet.getRange(1, 1).setNote('最終更新: ' + stamp);

  Logger.log('ダッシュボード更新完了: ' + ss.getUrl());
  return ss.getUrl();
}

function formatDashboard_(sheet, numRows) {
  var lastCol = DASHBOARD_HEADERS.length;
  var header = sheet.getRange(1, 1, 1, lastCol);
  header.setFontWeight('bold').setBackground('#2C2418').setFontColor('#F5F0E8');
  sheet.setFrozenRows(1);

  if (numRows > 1) {
    var dataRows = numRows - 1;
    // 通貨列: 本体売上,蘭,みや,売上合計,Meta売上,広告費,CPA
    ['本体売上', '蘭ちゃん売上', 'みやちゃん売上', '売上合計', 'Meta売上', '広告費', 'CPA'].forEach(function (h) {
      var col = DASHBOARD_HEADERS.indexOf(h) + 1;
      sheet.getRange(2, col, dataRows, 1).setNumberFormat('¥#,##0');
    });
    // ROAS: 小数2桁
    var roasCol = DASHBOARD_HEADERS.indexOf('ROAS') + 1;
    sheet.getRange(2, roasCol, dataRows, 1).setNumberFormat('0.00');
  }
  sheet.autoResizeColumns(1, lastCol);
}

function yen_(n) {
  if (n === null || n === undefined) return '-';
  return '¥' + Math.round(n).toLocaleString('en-US');
}
