/**
 * ParseMeisai.gs
 * 明細型（1施術1行）パーサ。蘭ちゃん・みやちゃん共通（読み取り専用）。
 *
 * 実データの特徴（要注意）:
 *   - 月ごとのブロックが縦に積まれ、各ブロック先頭付近に
 *     "施術日 / 名前 / 料金... / 顧客ルート" のヘッダー行がある。
 *   - 日付が抜けている行があり、列が左にズレることがある。
 *   - 料金列に「振込合計」「経費」等の金額が混在する。
 *   - 顧客ルートは D列だったり E列だったりバラバラ＋表記ゆれが多い。
 *
 * よって列を決め打ちせず、行を走査して次の方針で拾う:
 *   - 料金 = 名前より右で「最初にパースできる金額」（日付/分数は除外し
 *            振込合計や経費を拾わないようにする）
 *   - 顧客ルート = 行内で「最初に既知ルートへ正規化できるセル」
 *
 * 返り値: { "YYYY/MM": { sales:Number, metaSales:Number, metaCount:Number, rows:Number } }
 */
function parseMeisai_(spreadsheetId) {
  var result = {};
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheets = ss.getSheets();

  sheets.forEach(function (sheet) {
    var values = sheet.getDataRange().getValues();
    if (!values.length) return;

    var currentMonth = detectMonthKey_(sheet.getName()); // タブ名から取れれば初期値に
    var i = 0;
    while (i < values.length) {
      var row = values[i];

      // 月マーカー行（"2025/10" 等が単独で入っている）を検出して現在月を更新
      var mk = detectMonthFromRow_(row);
      if (mk) { currentMonth = mk; }

      // ヘッダー行（施術日 & 顧客ルート を含む）を検出
      if (isHeaderRow_(row)) {
        var nameCol = findColByKey_(row, ['名前']);
        // ヘッダーの次行から、次のヘッダー/月マーカーまでを明細として集計
        var j = i + 1;
        for (; j < values.length; j++) {
          var drow = values[j];
          if (isHeaderRow_(drow)) break;            // 次ブロックのヘッダー
          var nm = detectMonthFromRow_(drow);
          if (nm) { currentMonth = nm; continue; }  // 月マーカーは月更新のみ
          if (isBlankRow_(drow)) continue;

          var rec = parseDetailRow_(drow, nameCol);
          if (rec.amount <= 0 && !rec.route) continue; // 実質空行はスキップ

          if (currentMonth) {
            ensureMonth_(result, currentMonth);
            var bucket = result[currentMonth];
            bucket.sales += rec.amount;
            bucket.rows += 1;
            if (rec.route === 'Meta広告') {
              bucket.metaSales += rec.amount;
              bucket.metaCount += 1;
            }
          }
        }
        i = j;
        continue;
      }
      i++;
    }
  });

  return result;
}

/** 1明細行を { amount, route } に変換。 */
function parseDetailRow_(row, nameCol) {
  // 料金 = 行の左から「最初にパースできる金額」。
  //  - 日付("4/7")や分数("1/6")は parseAmount_ が除外する
  //  - 名前は数値でないので自然にスキップされる
  //  - 手当/経費/振込合計などの金額は右側にあるため、左から拾えば実料金が先に当たる
  //  - 日付欠落で列が左にズレた行(料金がA列)にも対応するため col0 から走査する
  var amount = 0;
  for (var c = 0; c < row.length; c++) {
    var a = parseAmount_(row[c]);
    if (a !== null && a !== 0) { amount = a; break; } // 最初の有効金額
  }
  // ルート: 行内で最初に既知ルートへ正規化できるセル
  var route = null;
  for (var c2 = 0; c2 < row.length; c2++) {
    var rt = normalizeRoute_(row[c2]);
    if (rt) { route = rt; break; }
  }
  return { amount: amount, route: route };
}

/** 行がヘッダー行か（施術日 と 顧客ルート を両方含む）。 */
function isHeaderRow_(row) {
  var hasDate = false, hasRoute = false;
  for (var c = 0; c < row.length; c++) {
    var k = normKey_(row[c]);
    if (k === '施術日') hasDate = true;
    if (k === '顧客ルート') hasRoute = true;
  }
  return hasDate && hasRoute;
}

/** 行から特定見出しの列インデックスを返す。 */
function findColByKey_(row, keys) {
  var set = keys.map(normKey_);
  for (var c = 0; c < row.length; c++) {
    if (set.indexOf(normKey_(row[c])) >= 0) return c;
  }
  return -1;
}

/** 行が「月マーカーのみ」なら月キーを返す。それ以外は null。 */
function detectMonthFromRow_(row) {
  // 非空セルが1つだけで、それが月として解釈できる場合
  var nonEmpty = [];
  for (var c = 0; c < row.length; c++) {
    var v = row[c];
    if (v !== '' && v !== null && v !== undefined) nonEmpty.push(v);
  }
  if (nonEmpty.length === 1) {
    return detectMonthKey_(nonEmpty[0]);
  }
  return null;
}

function isBlankRow_(row) {
  for (var c = 0; c < row.length; c++) {
    if (row[c] !== '' && row[c] !== null && row[c] !== undefined) return false;
  }
  return true;
}

function ensureMonth_(result, mKey) {
  if (!result[mKey]) {
    result[mKey] = { sales: 0, metaSales: 0, metaCount: 0, rows: 0 };
  }
}
