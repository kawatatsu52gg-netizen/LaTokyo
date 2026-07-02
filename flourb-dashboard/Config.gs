/**
 * Config.gs
 * Flourb 売上×広告 統合ダッシュボード 設定値。
 *
 * ここに ID や定数を集約する。アクセストークンなどの秘密情報は
 * ここに書かず、スクリプトプロパティ(PropertiesService)で管理する。
 */

var CONFIG = {
  // ── データソース（すべて読み取り専用。絶対に書き換えない） ──
  SOURCES: {
    // 本体売上「ハーブピーリング2026」: 日報グリッド型
    HONTEN: '1EkU2uL2ddvykyoEYZ08l55m5zu27RWWwTcP32a7I3E4',
    // 「蘭ちゃん　売上管理」: 明細型（料金(友達)/料金(その他)あり）
    RAN: '1iqoYOwTfGkI7VjOeabPo9OcWVg8OfXYn8tcXV8hh48Q',
    // 「みやちゃん　売上管理」: 明細型（料金1列）
    MIYA: '17cxYfVQO4OOqTH_j0RdrNVg3bBAoFjIHWnWKEPzBWzc'
  },

  // ── Meta 広告 ──
  META: {
    AD_ACCOUNT_ID: 'act_3949036212035732',
    API_VERSION: 'v21.0',
    // アクセストークンのスクリプトプロパティ名（値は直書きしない）
    TOKEN_PROPERTY: 'META_ACCESS_TOKEN'
  },

  // ── ダッシュボード出力先 ──
  // 出力用スプレッドシートIDを保存するプロパティ名。
  // 未設定の場合は初回実行時に新規スプレッドシートを自動作成し、ここに保存する。
  DASHBOARD_PROPERTY: 'DASHBOARD_SPREADSHEET_ID',
  DASHBOARD_SHEET_NAME: 'ダッシュボード',
  DASHBOARD_TITLE: 'Flourb 統合ダッシュボード',

  // ── 顧客ルートのプルダウン固定リスト ──
  ROUTE_OPTIONS: [
    'Meta広告',
    'Instagram',
    'Threads',
    'HotPepper',
    '紹介',
    '知人',
    'その他'
  ]
};
