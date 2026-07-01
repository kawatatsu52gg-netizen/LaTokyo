# Zoom MCP Server

Claude に接続して、チャットで日程を伝えると Zoom ミーティングの URL が発行される MCP サーバーです。
Zoom **Server-to-Server OAuth** を使い、TypeScript + Node.js（stdio トランスポート）で動きます。

チャット例:
> 「7月10日の15時から60分でミーティング作って」
→ Claude が `create_zoom_meeting` を呼び、`join_url` を返します。

---

## 5分でClaudeに繋ぐ手順

### 1. Zoom アプリを作成（Server-to-Server OAuth）

写真の Zoom アカウント（`contact.comedi111@gmail.com` に紐づくアカウント）でログインした状態で:

1. [Zoom App Marketplace](https://marketplace.zoom.us/) を開く
2. 右上 **Develop** → **Build App**
3. **Server-to-Server OAuth** を選び **Create**
4. アプリ名（例: `meeting-creator`）を入力
5. **App Credentials** タブに表示される次の3つを控える:
   - **Account ID** → `ZOOM_ACCOUNT_ID`
   - **Client ID** → `ZOOM_CLIENT_ID`
   - **Client Secret** → `ZOOM_CLIENT_SECRET`
6. **Scopes** タブ → **Add Scopes** → 次のスコープを追加:
   - `meeting:write:meeting`（ミーティング作成）
   - ※ Zoom の UI 表記では **View and manage meetings** / `meeting:write:admin` 相当。
     「ミーティングを作成」できる write 権限を付与してください。
7. **Activation** タブ → **Activate your app** で有効化

### 2. セットアップ

```bash
cd zoom-mcp-server
npm install
cp .env.example .env
# .env を開いて手順1で控えた3つの値を貼り付ける
npm run build
```

`.env`:

```
ZOOM_ACCOUNT_ID=xxxxxxxxxxxxxxxxx
ZOOM_CLIENT_ID=xxxxxxxxxxxxxxxxx
ZOOM_CLIENT_SECRET=xxxxxxxxxxxxxxxxx
```

> ⚠️ `.env` は `.gitignore` 済みでコミットされません。秘密情報は絶対にコミットしないでください。

### 3. 単体テスト（Claude に繋ぐ前の動作確認）

```bash
npm run test-meeting -- "2026-07-10T15:00:00" 60 "テスト"
```

`join_url` などが表示されれば認証・作成ともに成功です。
失敗した場合は Zoom API のレスポンス本文がそのまま表示されるので、
スコープ不足やアプリ未有効化などを確認してください。

### 4. Claude Desktop に接続

`claude_desktop_config.json` に以下を追記します。

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "zoom": {
      "command": "node",
      "args": ["/絶対パス/LaTokyo/zoom-mcp-server/dist/server.js"]
    }
  }
}
```

- `args` の絶対パスは自分の環境に合わせて置き換えてください
  （例: `pwd` で確認 → `/Users/you/LaTokyo/zoom-mcp-server/dist/server.js`）。
- 認証情報は `.env` から読み込むため、config に秘密情報を書く必要はありません。

Claude Desktop を**再起動**すると `zoom` サーバーが読み込まれます。
チャットで「7/10 15時から1時間でミーティング作って」のように伝えると URL が発行されます。

---

## MCP ツール仕様

**`create_zoom_meeting`**

| 入力 | 型 | 必須 | デフォルト | 説明 |
|------|----|------|-----------|------|
| `start_time` | string | ✅ | — | `YYYY-MM-DDTHH:mm:ss` 形式の JST ローカル時刻 |
| `duration` | number | ー | `60` | 分 |
| `topic` | string | ー | `ミーティング` | トピック |

**出力**（テキスト）: `join_url` / `meeting_id` / `password` / `start_time` / `duration`

> `start_url` はホスト専用のため、共有用として返すのは `join_url` のみです。

作成されるミーティングの設定（固定）:
`host_video: true` / `participant_video: true` / `waiting_room: true` /
`join_before_host: false` / `mute_upon_entry: true` / `approval_type: 2`、`timezone: Asia/Tokyo`。

---

## 仕組み

- **トークン取得**: `POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id=...`
  に `Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)` でアクセスし `access_token` を取得。
  有効期限は約1時間のため、**メモリ上で50分キャッシュ**して毎回は取得しません（`src/zoom.ts`）。
- **ミーティング作成**: `POST https://api.zoom.us/v2/users/me/meetings` に Bearer トークンで作成。
- **エラー**: Zoom API のレスポンス本文をそのまま表示（デバッグしやすく）。秘密情報はログに出しません。

## セキュリティ

- 認証情報は `.env` のみ。コードやログに秘密情報を出力しません。
- `.env` は `.gitignore` 済み。共有用テンプレートは `.env.example`（キー名のみ）。

## スクリプト

| コマンド | 内容 |
|----------|------|
| `npm run build` | TypeScript をビルド |
| `npm start` | MCP サーバーを起動（通常は Claude が起動） |
| `npm run test-meeting -- "<start_time>" [duration] [topic]` | 単体でミーティング作成を確認 |
