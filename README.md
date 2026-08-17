# Threads Auto-Optimization System

個人サロン経営者（整体・エステ・鍼灸・リラク・美容）向けThreads運用を、
**投稿 → データ蓄積 → 分析 → 仮説更新 → 次の投稿改善** で自動的に回すシステム。

GPTとClaudeが投稿案について議論・反証し、独立したJudge AIが品質を判定し、
投稿後の実データを学習して投稿内容と投稿時間を継続的に改善します。

設計の全体像・判断根拠は **[docs/DESIGN.md](docs/DESIGN.md)** を参照してください。

---

## 最初に知っておくべき制約

**Threads APIは投稿ごとの「プロフィール閲覧数・フォロー増加数・リンククリック数」を返しません。**
（返すのは views / likes / replies / reposts / quotes / shares のみ）

このシステムはそれを前提に設計されています:

| 欲しいデータ | 取得方法 |
| --- | --- |
| 表示・いいね・返信・再投稿・引用 | Threads API（投稿ごと・自動） |
| **リンククリック** | **自前リダイレクタで実測**（`/r/<slug>`）— 唯一の下流実測指標 |
| プロフィール閲覧・フォロー | 日次アカウント値からの按分推定 + 手入力で補正 |

スクレイピングは規約違反のため一切行いません。

---

## セットアップ

### 1. 依存インストール

```bash
npm install
```

### 2. 環境変数

`.env.example` を `.env.local` にコピーして埋めます。
**Phase 1（投稿管理・KPI・ヒートマップ）は最初の5つだけで動きます。**

```bash
DATABASE_URL=postgres://...    # Supabase の Connection string
APP_PASSWORD=...               # 管理画面のパスワード
SESSION_SECRET=...             # 32文字以上のランダム文字列
CRON_SECRET=...                # cronエンドポイント保護
NEXT_PUBLIC_APP_URL=https://...
```

### 3. DBの作成

```bash
npm run db:migrate   # テーブル作成
npm run db:seed      # 分類マスタ・初期スロット・スコア重みを投入
```

### 4. 起動

```bash
npm run dev
```

`http://localhost:3000` → パスワードでログイン。

### 5. 動作確認（任意）

合成データ4週分を投入して、スコアリング・バンディット・A/B・週次学習が
意図どおり動くかを検証します。**本番DBでは実行しないでください**（既存データを消します）。

```bash
DATABASE_URL=postgres://... npm run smoke
```

---

## あなたの操作が必要なところ

コード側は完成しています。以下は外部サービス側の作業なので、こちらでは代行できません。

| # | 作業 | 場所 |
| --- | --- | --- |
| 1 | Supabaseプロジェクト作成 → 接続文字列を `DATABASE_URL` へ | supabase.com |
| 2 | OpenAI APIキー発行・課金設定 → `OPENAI_API_KEY` | platform.openai.com |
| 3 | Anthropic APIキー発行・課金設定 → `ANTHROPIC_API_KEY` | console.anthropic.com |
| 4 | Meta開発者アカウント作成、アプリを「Threads」ユースケースで作成 | developers.facebook.com |
| 5 | 権限追加: `threads_basic` / `threads_content_publish` / `threads_manage_insights` / `threads_manage_replies` | 同上 |
| 6 | Redirect URI に `https://<your-domain>/api/threads/callback` を登録 | 同上 |
| 7 | App ID / App Secret を `THREADS_APP_ID` / `THREADS_APP_SECRET` へ | Vercel |
| 8 | Vercelにデプロイ（Cron利用のためHobby以上） | vercel.com |
| 9 | デプロイ後 `/settings` →「Threadsに接続する」でOAuth認可 | 管理画面 |

**4〜9が終わるまでも Phase 1 は使えます。** 手入力/CSVでデータを貯め始められます。

---

## 運用の流れ

### 自動（Vercel Cron）

| 時刻(JST) | 処理 |
| --- | --- |
| 03:00 | 翌日6枠を設計（バンディット + A/Bペア1組） |
| 03:30 | 6件を議論パイプラインで生成（GPT→Claude→GPT→Claude→Judge） |
| 10分おき | 投稿時刻が来たものを公開 |
| 毎時 | メトリクス収集（1h / 6h / 24h スナップショット） |
| 05:00 | スコア確定・予測誤差記録 |
| 月曜 04:00 | 週次AI分析・勝ちパターン更新・テーマ配分調整 |

`vercel.json` の cron は UTC 指定です（JSTから-9時間）。

### 手動

`/settings` の「ジョブを手動実行」から各処理を単発で叩けます。
Judge が85点に届かなかった投稿は `NEEDS_HUMAN` になるので、
`/posts?status=NEEDS_HUMAN` から本文を直して承認してください。

---

## 画面

| パス | 内容 |
| --- | --- |
| `/` | Today / Top / Worst / Best Time・Theme・Format・Hook / Weekly Insights / Next Experiments |
| `/posts` | 投稿一覧、CSVインポート |
| `/posts/[id]` | 本文編集・承認、実績KPI、手入力、Judge採点内訳、議論ログ |
| `/heatmap` | 曜日 × 投稿時間（指標切替可） |
| `/patterns` | 勝ちパターン（事後分布）・仮説・A/Bテスト結果 |
| `/debates` | Judge予測 vs 実績の散布図、議論ログ一覧 |
| `/insights` | 週次AIレポート |
| `/settings` | 接続状況、スコア重み、テーマ配分、ジョブ手動実行 |

---

## 設計上の重要な判断

**総合スコアは生の率を加重和しません。** like_rate は 2〜6%、follow_conversion_rate は
0.05〜0.5% と2桁違うため、生値で足すと数値の大きい指標が全てを決めてしまいます。
代わりに ①コホート平均への縮小推定 → ②コホート内パーセンタイル化 → ③加重和 の順で計算します。
これで重みが書いたとおりの意味を持ちます。詳細は `src/lib/scoring.ts`。

**exploit は実績のあるアームからしか選びません。** 未試行アームは Beta(1,1) = 一様分布のため、
Thompson抽出では既知の勝者（61%）を約39%の確率で上回ります。候補が12個あれば
ほぼ毎回どれかが勝ってしまい、exploit が explore と区別できなくなります。
未検証の値は explore 側で意図的に選びます。詳細は `src/lib/bandit.ts`。

**AI同士の議論は必ず止まります。** 最大3ラウンド、かつ1投稿あたりのコスト上限
（既定 $0.60）。どちらかに達したら `NEEDS_HUMAN` にして人間に渡します。

**Judgeは自分の予測ズレを次回に持ち越します。** 投稿前スコアと実績パーセンタイルの差を
記録し、直近45日の平均バイアスをJudgeのシステムプロンプトに注入します。
「AIの好み」ではなく実データに評価軸を寄せ続けるためのループです。

---

## ライセンス / 注意

- Threads APIの利用規約に従ってください。スクレイピングは実装していません。
- AIコストは `posts.ai_cost_usd` と `debates.cost_usd` に記録されます。
  `src/lib/ai/cost.ts` の単価表はご自身のアカウントの料金で確認してください
  （`AI_PRICE_OVERRIDES` 環境変数で上書き可能）。
