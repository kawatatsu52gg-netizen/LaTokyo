# LaTokyo 代官山 - 整体サロン予約管理システム

## 技術スタック

- **フロントエンド**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **データベース**: Supabase (PostgreSQL)
- **外部連携**: Google Calendar API / Google Sheets API

## セットアップ

### 1. 依存パッケージのインストール

```bash
cd salon-booking
npm install
```

### 2. Supabaseプロジェクトの作成

1. [Supabase](https://supabase.com) でプロジェクトを作成
2. `supabase-schema.sql` をSQLエディタで実行

### 3. Google APIの設定

1. Google Cloud Consoleでプロジェクトを作成
2. Calendar API と Sheets API を有効化
3. サービスアカウントを作成し、キーをダウンロード
4. カレンダーをサービスアカウントと共有
5. スプレッドシートを作成し、サービスアカウントに編集権限を付与
6. スプレッドシートの1行目にヘッダーを設定:
   `日付 | 顧客名 | メニュー | 金額 | ステータス | 支払方法 | 備考`

### 4. 環境変数の設定

`.env.local.example` をコピーして `.env.local` を作成し、値を設定:

```bash
cp .env.local.example .env.local
```

### 5. 開発サーバーの起動

```bash
npm run dev
```

## ページ構成

| URL | 説明 |
|-----|------|
| `/` | 外部予約ページ（顧客向け） |
| `/admin` | 管理画面（スタッフ向け） |

## 機能

### 外部予約ページ (`/`)
- 5ステップのウィザード形式（お悩み → メニュー → 日時 → お客様情報 → 確認）
- リアルタイムの空き時間チェック
- ダブルブッキング防止

### 管理画面 (`/admin`)
- Basic認証によるログイン
- 予約一覧のテーブル表示
- ステータス管理: 仮予約 → 確定 → 来店済 / キャンセル
- 支払方法・備考の編集
- ステータスフィルタリング

### 予約確定時の自動処理
- Googleカレンダーに予定を自動登録
- Googleスプレッドシートに1行追加

### ダブルブッキング防止
- APIレベル: 空き時間スロットの重複チェック
- DBレベル: PostgreSQLトリガーによる排他制御
