/**
 * MetaAds.gs
 * Meta Marketing API (Graph API) から月別の広告費(spend)を取得する。
 *
 * - アクセストークンはスクリプトプロパティ CONFIG.META.TOKEN_PROPERTY から取得。
 *   コードに直書きしない。ads_read 権限が必要。
 * - トークン未設定・API失敗でもエラーで止めず、null（広告費空欄）で続行する。
 *
 * 返り値: { "YYYY/MM": Number(spend) }  取得できなかった月は含めない/nullになる。
 */
function fetchMetaSpendByMonth_(monthKeys) {
  var out = {};
  var token = PropertiesService.getScriptProperties().getProperty(CONFIG.META.TOKEN_PROPERTY);
  if (!token) {
    Logger.log('META_ACCESS_TOKEN 未設定のため広告費は空欄で続行します。');
    return out; // 空 → 呼び出し側で「-」表示
  }

  monthKeys.forEach(function (mKey) {
    try {
      var range = monthDateRange_(mKey);
      var url = 'https://graph.facebook.com/' + CONFIG.META.API_VERSION + '/' +
        CONFIG.META.AD_ACCOUNT_ID + '/insights' +
        '?fields=spend' +
        '&time_range=' + encodeURIComponent(JSON.stringify({ since: range.since, until: range.until })) +
        '&access_token=' + encodeURIComponent(token);

      var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      var code = resp.getResponseCode();
      var body = resp.getContentText();
      if (code !== 200) {
        Logger.log('Meta API ' + mKey + ' 失敗 (' + code + '): ' + body);
        return;
      }
      var json = JSON.parse(body);
      if (json && json.data && json.data.length > 0 && json.data[0].spend != null) {
        out[mKey] = Number(json.data[0].spend);
      } else {
        out[mKey] = 0; // データ無し＝0円
      }
    } catch (e) {
      Logger.log('Meta API ' + mKey + ' 例外: ' + e);
    }
  });

  return out;
}

/** "YYYY/MM" → { since:"YYYY-MM-01", until:"YYYY-MM-末日" } */
function monthDateRange_(mKey) {
  var parts = mKey.split('/');
  var y = Number(parts[0]);
  var m = Number(parts[1]);
  var since = y + '-' + ('0' + m).slice(-2) + '-01';
  var last = new Date(y, m, 0).getDate(); // 翌月0日=当月末日
  var until = y + '-' + ('0' + m).slice(-2) + '-' + ('0' + last).slice(-2);
  return { since: since, until: until };
}
