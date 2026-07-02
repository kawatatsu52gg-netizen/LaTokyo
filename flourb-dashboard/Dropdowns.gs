/**
 * Dropdowns.gs
 * 蘭ちゃん・みやちゃんの「顧客ルート」列にプルダウン（データの入力規則）を設定する。
 *
 * - 「顧客ルート」という見出しを自動検出し、その下の列に適用。
 * - 既存の手書き値は消さない（allowInvalid = true）。
 * - 月ブロックが縦に積まれているため、ヘッダーが複数あっても各ブロックに対応。
 */
function setDropdowns() {
  var targets = [CONFIG.SOURCES.RAN, CONFIG.SOURCES.MIYA];
  var totalApplied = 0;

  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CONFIG.ROUTE_OPTIONS, true) // ドロップダウン表示
    .setAllowInvalid(true)                          // 既存の表記ゆれを消さない
    .setHelpText('顧客ルートを選択（既存の手書き値も可）')
    .build();

  targets.forEach(function (id) {
    var ss = SpreadsheetApp.openById(id);
    ss.getSheets().forEach(function (sheet) {
      var values = sheet.getDataRange().getValues();
      var maxRow = sheet.getMaxRows();

      // 「顧客ルート」ヘッダーの位置（複数ブロック対応）を集める
      var headerPositions = [];
      for (var r = 0; r < values.length; r++) {
        for (var c = 0; c < values[r].length; c++) {
          if (normKey_(values[r][c]) === '顧客ルート') {
            headerPositions.push({ row: r, col: c }); // 0始まり
          }
        }
      }

      // 各ヘッダーの「下」に適用。次の顧客ルートヘッダー直前まで、
      // 無ければシート末尾まで。
      for (var i = 0; i < headerPositions.length; i++) {
        var pos = headerPositions[i];
        var startRow = pos.row + 2; // 1始まりのヘッダー次行
        var endRow;
        // 同じ列で次に現れるヘッダー行を探す
        var next = null;
        for (var k = i + 1; k < headerPositions.length; k++) {
          if (headerPositions[k].col === pos.col && headerPositions[k].row > pos.row) {
            next = headerPositions[k]; break;
          }
        }
        endRow = next ? next.row : maxRow; // next.row(0始まり)=その1つ上まで(1始まり換算で next.row 行)
        var numRows = endRow - startRow + 1;
        if (numRows <= 0) continue;
        sheet.getRange(startRow, pos.col + 1, numRows, 1).setDataValidation(rule);
        totalApplied += numRows;
      }
    });
  });

  Logger.log('プルダウン設定完了。適用セル数(のべ): ' + totalApplied);
  return totalApplied;
}
