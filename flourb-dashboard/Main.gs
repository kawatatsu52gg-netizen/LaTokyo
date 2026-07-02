/**
 * Main.gs
 * エントリポイント。手動実行・トリガー設置・メニュー。
 */

/** カスタムメニュー（ダッシュボードSSを開いたとき用）。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Flourb')
    .addItem('ダッシュボード更新', 'updateDashboard')
    .addItem('顧客ルートのプルダウン設定', 'setDropdowns')
    .addItem('毎日自動更新を有効化', 'installDailyTrigger')
    .addToUi();
}

/**
 * すべてのソースを集計し、Meta広告費を取得し、ダッシュボードへ書き出す。
 */
function updateDashboard() {
  // 1) 各ソースをパース（読み取りのみ）
  var honten = parseHonten_();               // { "YYYY/MM": {honten, shinki, metaCount} }
  var ran = parseMeisai_(CONFIG.SOURCES.RAN); // { "YYYY/MM": {sales, metaSales, metaCount, rows} }
  var miya = parseMeisai_(CONFIG.SOURCES.MIYA);

  // 2) 対象月の和集合を作る（時系列ソート）
  var monthSet = {};
  [honten, ran, miya].forEach(function (obj) {
    Object.keys(obj).forEach(function (m) { monthSet[m] = true; });
  });
  var months = Object.keys(monthSet).sort();

  // 3) Meta広告費を取得（トークン未設定なら空）
  var spendByMonth = fetchMetaSpendByMonth_(months);

  // 4) 月ごとに指標を計算
  var rows = months.map(function (m) {
    var h = honten[m] || { honten: 0, shinki: 0, metaCount: 0 };
    var rn = ran[m] || { sales: 0, metaSales: 0, metaCount: 0 };
    var my = miya[m] || { sales: 0, metaSales: 0, metaCount: 0 };

    var salesTotal = h.honten + rn.sales + my.sales;

    // 新規数: 本体の新規客数を採用（明細側に新規/既存の区別が無いため）
    var shinki = h.shinki;

    // Meta新規数(合計) = 本体meta件数 + 蘭Meta件数 + みやMeta件数
    var metaCount = h.metaCount + rn.metaCount + my.metaCount;

    // Meta売上 = 蘭+みや実額 ＋ 本体概算(meta件数 × 客単価)
    var metaSalesActual = rn.metaSales + my.metaSales;
    var kyakutanka = safeDiv_(h.honten, h.shinki); // 本体客単価 = 本体売上 ÷ 新規客数
    var metaSalesEstimate = (kyakutanka === null) ? 0 : h.metaCount * kyakutanka;
    var metaSales = metaSalesActual + metaSalesEstimate;

    // 広告費
    var spend = (spendByMonth.hasOwnProperty(m)) ? spendByMonth[m] : null;

    // CPA = 広告費 ÷ Meta新規数(合計)、ROAS = Meta売上 ÷ 広告費
    var cpa = (spend === null) ? null : safeDiv_(spend, metaCount);
    var roas = (spend === null) ? null : safeDiv_(metaSales, spend);

    return {
      month: m,
      honten: h.honten,
      ran: rn.sales,
      miya: my.sales,
      salesTotal: salesTotal,
      shinki: shinki,
      metaCount: metaCount,
      metaSalesActual: metaSalesActual,
      metaSalesEstimate: metaSalesEstimate,
      metaSales: metaSales,
      spend: spend,
      cpa: cpa,
      roas: roas
    };
  });

  // 5) 書き出し
  var url = writeDashboard_(rows);
  Logger.log('updateDashboard 完了: ' + url);
  return url;
}

/**
 * 毎日1回動く時間主導型トリガーを設置する。
 * 重複設置しないよう、既存の updateDashboard トリガーを削除してから作る。
 */
function installDailyTrigger() {
  var handler = 'updateDashboard';
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyDays(1)
    .atHour(6) // 毎朝6時台(Asia/Tokyo)に更新
    .create();
  Logger.log('毎日自動更新トリガーを設置しました（updateDashboard / 6時台）。');
}

/** Meta アクセストークンを設定するヘルパー（コードに直書きしないための入口）。 */
function setMetaToken(token) {
  if (!token) throw new Error('token を引数で渡してください。');
  PropertiesService.getScriptProperties().setProperty(CONFIG.META.TOKEN_PROPERTY, token);
  Logger.log('META_ACCESS_TOKEN を保存しました。');
}
