# Threads Auto-Optimization System — 設計書

個人サロン経営者（整体・エステ・鍼灸・リラク・美容）向け Threads 運用を
**「投稿 → データ蓄積 → 分析 → 仮説更新 → 次の投稿改善」** で自動的に回すシステム。

目的は「AIに良さそうな投稿を書かせること」ではなく、
**実データから「相談につながる投稿パターン」を継続的に発見すること**。

---

## 0. 結論サマリ（先に読むところ）

| 論点 | 結論 |
| --- | --- |
| 技術構成 | Next.js 15 (App Router) + TypeScript + Postgres(Supabase) + Vercel Cron + Anthropic/OpenAI SDK |
| 最大の制約 | **Threads APIは投稿単位の「プロフィール閲覧 / フォロー / リンククリック」を返さない** |
| その回避策 | ①自前リダイレクタでLink CTRを投稿単位に実測 ②アカウント日次値を按分してProfile Visit/Followを推定 ③手入力/CSVで補正 |
| 総合スコア | 生の率の加重和は**やらない**（Like Rateが支配する）。コホート内パーセンタイル正規化 + 縮小推定 → 加重和 |
| 最適化 | Thompson Sampling（時間減衰つきBeta事後分布）、exploit 70% / explore 30% |
| Multi-Agent | GPT Strategist → Claude Critic → GPT Integrator → Claude Challenger → Judge、最大3ラウンド |
| MVP順序 | ユーザー案を一部入れ替え（後述 §7）。**Phase 1にThreads API読み取りを前倒し**する |

---

## 1. 要件整理

### 1.1 ターゲットと課題
整体 / エステ / 鍼灸 / リラクゼーション / 美容サロン の1〜数人規模の経営者。
新規集客・リピート率・売上・利益・資金繰り・広告運用・Instagram/Google集客・AI活用・多忙・KPI管理・仕組み化。

### 1.2 ファネル（これが全ての評価軸の根拠）

```
Threads表示(views) → 反応(like/reply/repost) → プロフィール閲覧 → フォロー → LINE/リンク遷移 → 相談
```

いいねは**ファネル最上流の弱いシグナル**。最終KPIは「相談数」。
現時点で相談数はまだ0〜少数なので、**相談に相関しやすい中間指標**を代理指標(proxy)として重く見る。

代理指標の優先度（相談への近さ順）:
1. Link CTR（自前計測可能・最も下流）
2. Follow Conversion Rate
3. Profile Visit Rate
4. Reply Rate（会話が起きた＝関係性の入口）
5. Repost / Quote Rate（新規リーチ拡大）
6. Like Rate（最も弱い）

### 1.3 非機能要件
- 1日6投稿 × 検証を回し続けても**AIコストが破綻しない**（1投稿あたり上限を持つ）
- AI同士が無限議論しない（最大3ラウンド、ハードストップ）
- 規約違反スクレイピングは行わない（公式APIか手入力のみ）
- 個人1名運用なので、認証はパスワード1つで十分

---

## 2. システム全体設計

```
                     ┌──────────────── Learning DB ────────────────┐
                     │ winning_patterns / hypotheses / insights    │
                     └───────────────▲──────────────┬──────────────┘
                                     │              │ context
                          weekly     │              ▼
                         analysis    │   ┌─────────────────────────┐
                                     │   │ Bandit Planner          │
                                     │   │ 1日6スロットの設計       │
                                     │   │ exploit70 / explore30   │
                                     │   │ + A/Bペア1組を強制       │
                                     │   └───────────┬─────────────┘
                                     │               ▼
                                     │   ┌─────────────────────────┐
                                     │   │ Debate Pipeline         │
                                     │   │ GPT Strategist          │
                                     │   │  → Claude Critic        │
                                     │   │  → GPT Integrator       │
                                     │   │  → Claude Challenger    │
                                     │   │  → Judge AI (独立)      │
                                     │   │ PASS(>=85 & !major)     │
                                     │   │ FAIL → 最大3ラウンド     │
                                     │   └───────────┬─────────────┘
                                     │               ▼ APPROVED
                                     │   ┌─────────────────────────┐
                                     │   │ Publisher (cron)        │
                                     │   │ Threads API 2段階投稿    │
                                     │   └───────────┬─────────────┘
                                     │               ▼
                                     │   ┌─────────────────────────┐
                                     │   │ Collector (1h/6h/24h)   │
                                     │   │ media insights          │
                                     │   │ + account daily insights│
                                     │   │ + link click redirector │
                                     │   └───────────┬─────────────┘
                                     │               ▼
                                     │   ┌─────────────────────────┐
                                     └───┤ Evaluator               │
                                         │ KPI → 正規化 → Perf Score│
                                         │ Judge予測との誤差を記録   │
                                         └─────────────────────────┘
```

---

## 3. State Machine

投稿1件のライフサイクル。`posts.status` に保持。

```
PLANNED
  │ (planner が slot/theme/format/hook/hypothesis を決定)
  ▼
DRAFTING ──────────────────────────────────────────┐
  │  round = 1..3                                  │
  │   STRATEGIST → CRITIC → INTEGRATOR             │
  │   → CHALLENGER → JUDGE                         │
  │                                                │
  ├─ JUDGE PASS (score>=85 && !major_issue) ───► APPROVED
  ├─ JUDGE FAIL && round<3 ────► 次ラウンドへ ──────┘
  └─ JUDGE FAIL && round==3 ──► NEEDS_HUMAN (or REJECTED)

APPROVED
  ▼ (scheduled_at を待つ)
SCHEDULED
  ▼ publisher cron
PUBLISHING ──失敗──► FAILED (リトライ3回、指数バックオフ)
  ▼ 成功 (threads_media_id 取得)
PUBLISHED
  ▼ collector cron (+1h, +6h, +24h)
COLLECTING
  ▼ 24h スナップショット確定
EVALUATED   ← performance_score / percentile / prediction_error 確定
```

不変条件:
- `DRAFTING` の総ラウンド数は必ず ≤ 3。超えたら強制的に `NEEDS_HUMAN`。
- `PUBLISHING` は同一投稿に対して排他（`FOR UPDATE SKIP LOCKED`）。
- `EVALUATED` になった投稿だけが winning_patterns の学習対象。

---

## 4. DB設計

Postgres。全テーブル `created_at timestamptz default now()`。

### 4.1 posts — 投稿の中心テーブル

| column | type | 説明 |
| --- | --- | --- |
| id | uuid pk | |
| status | text | PLANNED / DRAFTING / APPROVED / SCHEDULED / PUBLISHING / PUBLISHED / EVALUATED / NEEDS_HUMAN / REJECTED / FAILED |
| scheduled_at | timestamptz | JST基準で決めた投稿予定時刻(UTC保存) |
| published_at | timestamptz | |
| jst_date | date | 分析用（JSTの日付） |
| jst_dow | smallint | 0=日..6=土 |
| jst_slot | text | '06:30' 等 |
| theme | text | acquisition / retention / revenue / ai / honest |
| format | text | 12種（§4.7） |
| hook_type | text | |
| cta_type | text | none / question / reply_prompt / profile / link / dm |
| length_bucket | text | s(≤80) / m(81-150) / l(151-300) / xl(>300) |
| char_count | int | |
| body | text | 本文 |
| target_problem | text | 誰のどの悩みに刺すか |
| hypothesis_id | uuid fk | 今回検証する仮説 |
| experiment_id | uuid fk | A/Bペアに属する場合 |
| variant | text | 'A' / 'B' / null |
| arm_key | text | bandit のアーム識別子（theme\|format\|hook\|slot\|len） |
| selection_mode | text | exploit / explore |
| threads_media_id | text | 公開後にAPIから取得 |
| link_slug | text | 自前リダイレクタ用（CTR実測） |
| judge_score | numeric | 投稿前の予測点 0-100 |
| performance_score | numeric | 実績スコア 0-100 |
| performance_percentile | numeric | コホート内 0-100 |
| prediction_error | numeric | judge_score - performance_percentile |
| ai_cost_usd | numeric | この投稿の生成にかかった総額 |

### 4.2 post_metrics — 時点スナップショット（1投稿に複数行）

| column | type |
| --- | --- |
| post_id | uuid fk |
| snapshot_at | timestamptz |
| horizon | text ('1h' / '6h' / '24h' / 'manual') |
| source | text ('api' / 'manual' / 'csv' / 'estimated') |
| impressions | int （Threads APIの `views`） |
| likes / replies / reposts / quotes / shares | int |
| profile_visits | int nullable（推定or手入力） |
| follows | int nullable（推定or手入力） |
| link_clicks | int（自前リダイレクタ実測） |

派生KPIはビュー `post_metrics_kpi` で計算（§5）。

### 4.3 account_daily — アカウント単位日次（按分の元データ）

| date | views | profile_visits | follows_delta | followers_total |

Threads APIのアカウントinsightsから取得。投稿単位に按分してpost_metricsの
`profile_visits` / `follows`（source='estimated'）を埋める。

### 4.4 debates — GPT/Claude 議論ログ

| column | type |
| --- | --- |
| id, post_id | uuid |
| round | int (1-3) |
| agent | text (strategist / critic / integrator / challenger / judge) |
| provider | text (openai / anthropic) |
| model | text |
| input_summary | jsonb |
| output | jsonb（各エージェントの構造化出力そのまま） |
| input_tokens / output_tokens | int |
| cost_usd | numeric |
| latency_ms | int |

### 4.5 judge_scores

| post_id, round, hook, target_fit, empathy, reply_probability, originality, profile_visit_probability, naturalness, total_score, approved(bool), major_issue(bool), unresolved_issues jsonb, confidence numeric |

### 4.6 その他

- **experiments**: `variable`(検証変数1つ), `variant_a_post_id`, `variant_b_post_id`, `primary_metric`, `result`(a_wins/b_wins/inconclusive), `p_value`, `decided_at`
- **hypotheses**: `statement`, `dimension`, `status`(untested/testing/supported/rejected), `evidence_n`, `effect_size`, `confidence`
- **winning_patterns**: `dimension`(theme/format/hook/slot/dow/length/cta), `value`, `metric`, `lift`(vs全体平均), `sample_n`, `posterior_alpha`, `posterior_beta`, `rank`, `updated_at`
- **weekly_insights**: `week_start`, `posts_analyzed`, `findings jsonb`, `next_actions jsonb`, `judge_calibration jsonb`, `report_md text`
- **score_weights**: `version`, `weights jsonb`, `active bool` — 重みをDB管理し、過去スコアを再現可能に
- **taxonomy**: theme/format/hook/cta の定義とターゲット配分（DB管理で可変）

### 4.7 分類マスタ

**theme（初期配分）**: acquisition 40% / retention 25% / revenue 15% / ai 10% / honest 10%
**format（12種）**: paradox(逆説) / diagnostic(診断) / question(質問) / number(数字) / failure(失敗談) / experience(実体験) / howto(ノウハウ) / problem(問題提起) / before_after / ai_use / owner_relatable(あるある) / strong_opinion(強い意見)
**hook_type**: contrarian / empathy / number_shock / question_open / confession / callout / scene / warning
**cta_type**: none / question / reply_prompt / profile / link / dm

---

## 5. KPI設計

### 5.1 生の率（`post_metrics_kpi` ビュー）

impressions = Threads APIの `views`。分母0のときは NULL。

```
engagement_rate         = (likes + replies + reposts + quotes) / impressions
reply_rate              = replies        / impressions
like_rate               = likes          / impressions
repost_rate             = (reposts + quotes) / impressions
profile_visit_rate      = profile_visits / impressions
follow_conversion_rate  = follows        / impressions
link_ctr                = link_clicks    / impressions
```

※ `repost_rate` は「拡散」という同一の意味を持つ quotes を含める（元要件は reposts のみだが、
Threads では引用も新規リーチを生むため合算が合理的。両方を別々にも保持する）。

### 5.2 なぜ「生の率の加重和」ではダメか

各指標のスケールが2桁違う:

| 指標 | 実務的なレンジ |
| --- | --- |
| like_rate | 2〜6% |
| engagement_rate | 3〜8% |
| reply_rate | 0.2〜1.5% |
| profile_visit_rate | 0.3〜2% |
| follow_conversion_rate | 0.05〜0.5% |

`0.20×ER + 0.25×ReplyRate + ...` と生値で足すと、**数値の大きい engagement_rate と like_rate が
ほぼ全てを決める**。Reply重視のつもりが実質いいね数ランキングになる。これが元案の最大の落とし穴。

### 5.3 修正版：コホート内パーセンタイル正規化 + 縮小推定

**Step 1: 縮小推定（Empirical Bayes shrinkage）**
表示数の少ない投稿がノイズで1位になるのを防ぐ。

```
smoothed_rate = (x + μ·k) / (n + k)
  x = 分子（replies等）, n = impressions
  μ = コホート平均レート, k = 擬似表示数（既定 300）
```

表示100で返信3（3.0%）は、コホート平均0.6%へ引き戻され約1.2%になる。
表示5000で返信150（3.0%）はほぼ3.0%のまま。

**Step 2: コホート内パーセンタイル**
コホート = 直近60日 かつ impressions ≥ 100 の EVALUATED 投稿。
各指標の smoothed_rate をコホート内で順位付けし 0〜100 に変換。

**Step 3: 重み付き合成**

`score_weights` テーブルでバージョン管理。

**v1_api_only（API単独で取得できる指標のみ。運用初期の既定）**

| 指標 | 重み | 理由 |
| --- | --- | --- |
| reply_rate | 30 | 会話＝関係性の入口。相談への距離が最も近い |
| link_ctr | 20 | 自前計測で唯一実測できる下流指標 |
| repost_rate(+quote) | 20 | 新規リーチ拡大＝母数を増やす |
| engagement_rate | 20 | 総合的な刺さり |
| like_rate | 10 | 弱いが無視はしない |

**v2_full（プロフィール閲覧/フォローの投稿単位データが入ったら切替）**

| 指標 | 重み |
| --- | --- |
| reply_rate | 25 |
| profile_visit_rate | 25 |
| follow_conversion_rate | 20 |
| engagement_rate | 15 |
| repost_rate | 10 |
| link_ctr | 5 |

> **元案（ER20/Reply25/PV25/Follow20/Repost10）への回答**
> 方向性（Reply/PV/Followを重く）は正しいので v2_full にほぼそのまま採用しました。
> 変更点は3つ：(a) 生値ではなくパーセンタイルで合成する、(b) Link CTRを明示的に加える
> （唯一の実測下流指標のため）、(c) 運用初期はPV/Followが取れないので v1 を既定にする。

**Step 4: performance_percentile** — performance_score 自体をコホート内でパーセンタイル化。
Judgeの100点満点と直接比較するため。

### 5.4 Prediction Error

```
prediction_error = judge_score - performance_percentile
  正 → AIが過大評価（「良い投稿」判定が実データで裏切られた）
  負 → AIが過小評価
```

週次で集計:
- `bias` = 直近30投稿の平均誤差
- `mae` = 平均絶対誤差
- `spearman` = judge_score と performance_percentile の順位相関
- 項目別誤差（Hook偏重か、Reply予測が甘いか等）

→ 次週のJudgeプロンプトに**キャリブレーション注記**として注入する。
例:「直近30投稿でJudgeは平均+18点の過大評価。特にReply Probabilityの見積もりが甘い傾向。」

これが「AIが自分の目を実データで矯正する」ループの実体。

---

## 6. 投稿最適化ロジック

### 6.1 アーム定義

```
arm_key = theme | format | hook_type | slot | length_bucket
```
組合せ爆発を避けるため、**次元ごとに独立したBeta事後分布**を持つ（naive factorization）。
交互作用は winning_patterns に「組合せパターン」として別途記録し、
サンプルが溜まったものだけ複合アームに昇格させる。

### 6.2 報酬の定義

二値化: `reward = 1 if performance_percentile >= 70 else 0`
（「上位30%に入ったか」。連続値より外れ値に強く、Beta事後と相性が良い）

### 6.3 Thompson Sampling + 時間減衰

```
w_i     = 0.5 ^ (age_days / 30)      # 半減期30日
alpha_v = 1 + Σ w_i · r_i
beta_v  = 1 + Σ w_i · (1 - r_i)
sample  = Beta(alpha_v, beta_v).rvs()
```

時間減衰があるので、アルゴリズムに触らなくても
「1ヶ月前に強かったパターンが飽きられた」ことに自動追従する。

### 6.4 1日6枠の組み立て

```
for slot in [06:30, 08:30, 10:30, 12:30, 15:30, 21:30]:
    mode = 'explore' if rand() < 0.30 else 'exploit'
    exploit: 各次元で Thompson サンプル最大の値を採用
    explore: 試行回数が最少の値、または active な hypothesis が指す値を採用
制約（diversity constraints）:
  - format は6枠すべて異なる
  - 同一themeは連続しない、かつ1日で最大3回
  - theme全体はターゲット配分から±1枠以内に収める
  - hook_type は同日で最大2回まで
```

### 6.5 A/Bテスト（1日1ペア強制）

6枠のうち、時間帯の近い2枠（例 10:30 と 12:30）を実験ペアに指定。
**変数は1つだけ変える。** 他の次元は完全一致させる。

```
A: 10:30 / acquisition / paradox / contrarian / m
B: 12:30 / acquisition / question / contrarian / m   ← format だけ違う
```

24h後に主要指標（既定 reply_rate）で2標本比率検定。
`p < 0.15` なら勝者を hypotheses に「supported」として昇格（n が小さい運用なので
有意水準は緩め、代わりに反復回数で担保する）。

### 6.6 投稿時刻の最適化（Phase 4）

`dow × slot` のヒートマップが十分埋まったら（各セル n ≥ 5）、
slot 自体をバンディットのアームに昇格し、±30分の近傍スロットを explore 対象に加える。
初期6スロットは「正解」ではなく「初期事前分布」として扱う。

---

## 7. Threads API でできること / できないこと

公式ドキュメント（developers.facebook.com/docs/threads）および2026年時点の公開情報より。

### 7.1 できる

| 機能 | エンドポイント | 必要スコープ |
| --- | --- | --- |
| 投稿（2段階: コンテナ作成→公開） | `POST /{user-id}/threads` → `POST /{user-id}/threads_publish` | `threads_basic`, `threads_content_publish` |
| 投稿ごとのインサイト | `GET /{media-id}/insights` | `threads_manage_insights` |
| 自分の投稿一覧 | `GET /{user-id}/threads` | `threads_basic` |
| アカウント単位インサイト | `GET /{user-id}/threads_insights` | `threads_manage_insights` |
| 投稿レート残数 | `GET /{user-id}/threads_publishing_limit` | `threads_basic` |
| 返信の取得・管理 | `GET /{media-id}/replies` 他 | `threads_manage_replies` |

**投稿ごとに取得できるメトリクス**: `views` / `likes` / `replies` / `reposts` / `quotes` / `shares`
**アカウント単位で取得できるメトリクス**: `views` / `likes` / `replies` / `reposts` / `quotes` /
`followers_count` / `follower_demographics`

**レート制限**: 投稿 250件/24h（移動窓）、返信 1000件/24h、削除 100件/24h。
→ 1日6投稿は余裕。

### 7.2 できない（ここが設計の分岐点）

| 欲しいデータ | 状況 | 本システムでの代替 |
| --- | --- | --- |
| **投稿ごとのプロフィール閲覧数** | ✗ API未提供（アカウント日次のみ） | ①日次按分で推定 ②アプリ内insightsのスクショから手入力 |
| **投稿ごとのフォロー増加数** | ✗ API未提供 | 同上（日次のfollowers差分を按分） |
| **投稿ごとのリンククリック** | ✗ API未提供 | **自前リダイレクタで実測**（最も精度が高い） |
| 予約投稿 | ✗ | 自前cronで実行（本システムのPublisher） |
| 他人の投稿の取得 | ✗ | 不要 |

### 7.3 代替手段の詳細

**(a) リンククリック — 自前リダイレクタ（推奨・実測）**
投稿本文に貼るURLを `https://<app>/r/<slug>` にする。
アクセス時に `post_id` 紐付きでカウントしてから本来のLINE/LPへ302。
→ **投稿単位のLink CTRが完全に実測できる**。規約上も問題なし。

**(b) プロフィール閲覧 / フォロー — 日次按分による推定**
```
その日のアカウント profile_visits = P
その投稿の views シェア = v_i / Σv
推定 profile_visits_i = P × (v_i / Σv) × 補正係数
```
`source='estimated'` として保存し、実測値と混在させない。
按分は粗いが、**同じ日の6投稿の相対比較**には十分使える（同一の按分バイアスがかかるため）。

**(c) 手入力 / CSVインポート**
Threadsアプリの投稿インサイト画面には表示回数などが出る。
ダッシュボードから投稿ごとに手入力できるフォームを用意（`source='manual'`）。
CSV一括インポートも対応（`source='csv'`）。手入力値は常に推定値より優先。

**(d) やらないこと**
スクレイピングは規約違反のため実装しない。Meta Insights CSVはThreadsを含まないため対象外。

### 7.4 あなたの作業が必要なところ（ここだけ人手）

| # | 作業 | 場所 |
| --- | --- | --- |
| 1 | Meta開発者アカウント作成、アプリを「Threads」ユースケースで作成 | developers.facebook.com |
| 2 | `threads_basic` / `threads_content_publish` / `threads_manage_insights` / `threads_manage_replies` の権限追加 | アプリ設定 |
| 3 | Redirect URI に `https://<your-domain>/api/threads/callback` を登録 | Threads > 設定 |
| 4 | App ID / App Secret を環境変数へ | Vercel |
| 5 | OpenAI APIキー発行・課金設定 | platform.openai.com |
| 6 | Anthropic APIキー発行・課金設定 | console.anthropic.com |
| 7 | Supabaseプロジェクト作成、接続文字列を環境変数へ | supabase.com |
| 8 | Vercelにデプロイ（Cron利用のためHobby以上） | vercel.com |

**これ以外は全て自動で進めます。** Phase 1〜2はThreads API接続なしでも動作します。

---

## 8. Agent Roles / Judge Schema / Debate Loop

### 8.1 共通ルール
- 全エージェントの出力は**JSON Schema強制**（OpenAI: `response_format: json_schema` / Anthropic: `output_config.format`）
- 全呼び出しで token/cost を `debates` に記録
- 1投稿あたりのAIコスト上限 `MAX_COST_PER_POST_USD`（既定 $0.60）。超えたら即 `NEEDS_HUMAN`

### 8.2 GPT Strategist（一次案）

**入力**: 直近7日の投稿全文とKPI / 直近30日Top10・Worst10 / 現在の勝ちパターン / 検証仮説 /
投稿予定の曜日・時刻 / 割当てられた theme・format・hook_type / テーマ配分の現況

**出力**:
```json
{ "target_problem","theme","format","hook_type","cta_type",
  "hypothesis","goal","post_text","cta","reason" }
```

### 8.3 Claude Critic（批判のみ。書き直さない）

12の評価軸（ターゲット適合 / Hookの強さ / 自分ごと化 / Threadsらしさ / 宣伝臭 /
返信誘発 / プロフィール誘導 / 既視感 / 過去投稿との重複 / AI文体 / 炎上・信頼毀損リスク / CVR視点）。

**出力**:
```json
{ "critical_issues":[{"axis","issue","why_it_matters"}],
  "minor_issues":[...], "improvement_suggestions":[...],
  "alternative_hook":"...", "duplicate_of_post_id": null }
```

過去30日の投稿本文を渡し、**重複検知**をClaudeに担当させる（コサイン類似度より意味重複に強い）。

### 8.4 GPT Integrator（採否判断 + 第2案）

Criticの各指摘を `ACCEPT` / `PARTIAL_ACCEPT` / `REJECT` に分類し、**理由を1行で記録**。
そのうえで改善版 `post_text` を生成。

```json
{ "decisions":[{"issue_ref","verdict","reason"}],
  "post_text":"...", "changes_made":[...] }
```

### 8.5 Claude Final Challenger（同意しないことが仕事）

「もっと強いHookはないか / 論理破綻 / CTAの自然さ / 返信ハードル /
プロフィールを見たくなる余白 / 専門家ぶり / コンサル営業臭」を再検証。

```json
{ "remaining_concerns":[...], "stronger_hook_candidate":"...",
  "verdict":"ship" | "revise", "revise_reason":"..." }
```

### 8.6 Judge AI（独立評価者・作成に一切関与しない）

**別インスタンス・別systemプロンプト。議論ログは渡さず、最終本文とメタ情報のみ渡す**
（議論を見せると「頑張ったから高得点」バイアスが出る）。

| 項目 | 配点 |
| --- | --- |
| Hook | 20 |
| Target Fit | 15 |
| Empathy | 15 |
| Reply Probability | 20 |
| Originality | 10 |
| Profile Visit Probability | 10 |
| Naturalness | 10 |

```json
{ "hook":n,"target_fit":n,"empathy":n,"reply_probability":n,
  "originality":n,"profile_visit_probability":n,"naturalness":n,
  "total_score":n,"approved":bool,"major_issue":bool,
  "unresolved_issues":[...],"confidence":0.0-1.0 }
```

**合格条件**: `total_score >= 85 && major_issue == false`
Judgeプロンプトには**前週のキャリブレーション注記**（§5.4）を必ず注入する。

### 8.7 Debate Loop

```
round 1: Strategist → Critic → Integrator → Challenger → Judge
  PASS → APPROVED
  FAIL → Judgeの unresolved_issues を StrategistとClaude双方に返却
round 2: 同上（前ラウンドの本文 + Judge指摘を入力に追加）
round 3: 同上
3ラウンド超 or コスト上限超 → NEEDS_HUMAN（人間レビュー待ち）
```

1投稿 = 最大15回のLLM呼び出し。想定コスト: 1ラウンド約$0.08〜0.15、
3ラウンドで最大$0.45程度。1日6投稿×30日で月$30〜80のレンジ。

---

## 9. Learning Logic（週次）

毎週月曜 04:00 JST に実行:

1. 直近7日 + 直近30日の EVALUATED 投稿を集計
2. 各次元（theme/format/hook/slot/dow/length/cta）のBeta事後を再計算 → `winning_patterns` 更新
3. `dow × slot` ヒートマップ再計算
4. 進行中 experiments の判定
5. Judgeキャリブレーション（bias/MAE/Spearman）算出
6. Claude に集計結果（生データではなく統計サマリ）を渡し、週次レポート生成
   - 今週わかったこと（数値の裏付け必須）
   - 効かなかったこと
   - 来週の行動指針（テーマ配分・時間帯配分の具体的な変更案）
   - 次に検証すべき仮説3つ → `hypotheses` に自動登録
7. テーマ配分の自動更新（既定配分から最大±10ptまで、1週あたり最大±5pt）

配分を一気に動かさないのは、**探索が枯れて局所最適に固定されるのを防ぐため**。

---

## 10. MVP実装順（提案）

元案から**Phase 1にThreads API読み取りを前倒し**します。理由は、
手入力運用を1ヶ月続けると確実に破綻し、データが欠損してその後の分析が全て狂うためです。
逆に**自動投稿は後回し**で問題ありません（手動投稿でもデータは貯まる）。

| Phase | 内容 | 実装 | 検証状況 |
| --- | --- | --- | --- |
| **1** | DB / 投稿管理 / 手入力 & CSV / KPI計算 / スコア / ランキング / ヒートマップ / ダッシュボード | 済 | 実DBで疎通確認済（`npm run smoke`） |
| **1.5** | Threads API 読み取り連携（OAuth + insights収集）+ リンククリック計測 | 済 | リンク計測は実測確認済。**Threads APIは実キー未投入のため未検証** |
| **2** | Multi-Agent 生成パイプライン（GPT×Claude×Judge）+ Bandit Planner | 済 | Plannerは検証済。**LLM呼び出しは実キー未投入のため未検証** |
| **3** | 自動投稿（Publisher cron）+ 1h/6h/24h 自動収集 | 済 | **実キー未投入のため未検証** |
| **4** | 週次AI分析 / 勝ちパターン自動更新 / テーマ配分・投稿時刻の自動最適化 | 済 | 統計部分は検証済。AIレポート生成は未検証 |

> 「未検証」は、APIキーが無いためこの環境で実通信テストができていない、という意味です。
> コードパスは型チェック・ビルド・スキーマ整合まで通っています。
> キー投入後に `/settings` の「ジョブを手動実行」から1つずつ確認してください。

Phase 1のみでも「毎日手入力 → スコア → ヒートマップ」が回るので、
APIキーが揃うまでの間もデータ蓄積を止めずに始められます。

---

## 11. 環境変数

```bash
# --- 必須（Phase 1） ---
DATABASE_URL=postgres://...              # Supabase の Connection string (pooler推奨)
APP_PASSWORD=...                         # 管理画面ログイン用
SESSION_SECRET=...                       # 32文字以上のランダム文字列
CRON_SECRET=...                          # cronエンドポイント保護
NEXT_PUBLIC_APP_URL=https://...          # リダイレクタのベースURL

# --- Phase 2（AI生成） ---
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_MODEL=gpt-5.1                     # 未指定なら既定値
ANTHROPIC_MODEL=claude-opus-5
ANTHROPIC_JUDGE_MODEL=claude-opus-5
MAX_DEBATE_ROUNDS=3
MAX_COST_PER_POST_USD=0.60

# --- Phase 3（Threads API） ---
THREADS_APP_ID=...
THREADS_APP_SECRET=...
THREADS_REDIRECT_URI=https://<domain>/api/threads/callback

# --- 任意 ---
TZ=Asia/Tokyo
LINK_DESTINATION_DEFAULT=https://lin.ee/...   # リダイレクタの既定遷移先
```

---

## 12. ディレクトリ構成

```
.
├── docs/DESIGN.md               ← この文書
├── db/
│   ├── migrations/0001_init.sql
│   └── seed.sql
├── src/
│   ├── app/
│   │   ├── page.tsx                    ダッシュボード
│   │   ├── posts/page.tsx              投稿一覧・手入力
│   │   ├── heatmap/page.tsx            曜日×時間ヒートマップ
│   │   ├── patterns/page.tsx           勝ちパターン / 仮説 / 実験
│   │   ├── debates/page.tsx            GPT vs Claude 議論ログ
│   │   ├── insights/page.tsx           週次レポート
│   │   ├── login/page.tsx
│   │   └── api/
│   │       ├── cron/{plan,generate,publish,collect,evaluate,weekly}/route.ts
│   │       ├── posts/...               CRUD + メトリクス入力
│   │       ├── import/csv/route.ts
│   │       ├── threads/{auth,callback}/route.ts
│   │       └── r/[slug]/route.ts       リンククリック計測
│   ├── lib/
│   │   ├── db.ts  env.ts  auth.ts
│   │   ├── taxonomy.ts                 theme/format/hook/cta 定義
│   │   ├── kpi.ts  scoring.ts          正規化・縮小推定・合成スコア
│   │   ├── bandit.ts                   Thompson Sampling
│   │   ├── planner.ts                  1日6枠の設計 + A/Bペア
│   │   ├── attribution.ts              PV/Follow の日次按分
│   │   ├── stats.ts                    比率検定・Spearman
│   │   ├── threads.ts                  Threads API クライアント
│   │   ├── ai/{openai,anthropic,cost}.ts
│   │   ├── agents/{schemas,prompts,pipeline}.ts
│   │   └── learning/{analyze,weekly}.ts
│   └── components/
└── vercel.json                  Cron定義
```

---

## 13. Cron スケジュール（vercel.json）

| 時刻(JST) | エンドポイント | 内容 |
| --- | --- | --- |
| 毎日 03:00 | `/api/cron/plan` | 翌日6枠の設計（bandit + A/Bペア） |
| 毎日 03:30 | `/api/cron/generate` | 6件の議論パイプライン実行 |
| 各投稿時刻 | `/api/cron/publish` | 10分おきに走査、時刻が来たものを投稿 |
| 毎時 | `/api/cron/collect` | 1h/6h/24h 経過投稿のメトリクス収集 |
| 毎日 05:00 | `/api/cron/evaluate` | 24h経過分のスコア確定 |
| 月曜 04:00 | `/api/cron/weekly` | 週次AI分析・勝ちパターン更新 |

Vercel CronはUTC指定のため、上記からJST(+9)を引いた値を `vercel.json` に記述。

---

## 14. 実装タスク一覧

- [x] リポジトリ雛形 / TS / Tailwind / Postgres接続
- [x] マイグレーション（全テーブル + KPIビュー）+ シード（分類マスタ・初期スロット・重み）
- [x] 認証（パスワード + 署名Cookie）
- [x] KPI計算・縮小推定・パーセンタイル正規化・総合スコア
- [x] 投稿CRUD / メトリクス手入力 / CSVインポート
- [x] ダッシュボード（Today / Top / Worst / Best Time・Theme・Format・Hook）
- [x] 曜日×時間ヒートマップ（指標切替）
- [x] リンククリック計測リダイレクタ
- [x] Thompson Sampling バンディット + 1日6枠プランナー + A/Bペア生成
- [x] Multi-Agentパイプライン（Strategist/Critic/Integrator/Challenger/Judge）
- [x] 議論ログ・コスト記録・ラウンド上限・コスト上限
- [x] Threads API クライアント（OAuth / 投稿 / insights）
- [x] Publisher / Collector cron
- [x] PV・Follow の日次按分
- [x] Evaluator（Performance Score / Prediction Error）
- [x] 週次AI分析 + 勝ちパターン自動更新 + テーマ配分自動調整
- [x] 議論ログUI / 勝ちパターンUI / 週次レポートUI
- [ ] Threads OAuth の実接続テスト（← APIキー投入後、要実機確認）
- [ ] 本番デプロイ + Cron有効化（← Vercel設定後）
