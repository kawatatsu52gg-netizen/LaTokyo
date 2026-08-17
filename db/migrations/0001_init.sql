-- Threads Auto-Optimization System — initial schema
-- Postgres 14+

create extension if not exists "pgcrypto";

-- ============================================================
-- taxonomy: theme / format / hook / cta の定義とターゲット配分
-- ============================================================
create table if not exists taxonomy (
  id            uuid primary key default gen_random_uuid(),
  dimension     text not null,          -- theme | format | hook_type | cta_type | slot
  value         text not null,
  label_ja      text not null,
  description   text,
  target_share  numeric,                -- theme のみ使用 (0-1)
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (dimension, value)
);

-- ============================================================
-- score_weights: 総合スコアの重み。バージョン管理して過去を再現可能に
-- ============================================================
create table if not exists score_weights (
  version    text primary key,
  weights    jsonb not null,   -- { "reply_rate": 30, ... } 合計100
  note       text,
  active     boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- hypotheses: 検証中の仮説
-- ============================================================
create table if not exists hypotheses (
  id          uuid primary key default gen_random_uuid(),
  statement   text not null,
  dimension   text,             -- theme | format | hook_type | slot | length | cta_type | combo
  target_value text,
  status      text not null default 'untested', -- untested|testing|supported|rejected
  evidence_n  int not null default 0,
  effect_size numeric,
  confidence  numeric,
  source      text,             -- weekly_ai | manual | experiment
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- experiments: 1投稿あたり検証変数1〜2個のA/Bペア
-- ============================================================
create table if not exists experiments (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  variable        text not null,        -- 変えた変数(1つ)
  control_value   text,
  treatment_value text,
  primary_metric  text not null default 'reply_rate',
  jst_date        date,
  variant_a_post_id uuid,
  variant_b_post_id uuid,
  result          text,                 -- a_wins|b_wins|inconclusive
  p_value         numeric,
  lift            numeric,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- posts: 中心テーブル
-- ============================================================
create table if not exists posts (
  id              uuid primary key default gen_random_uuid(),
  status          text not null default 'PLANNED',
  -- PLANNED|DRAFTING|APPROVED|SCHEDULED|PUBLISHING|PUBLISHED|EVALUATED
  -- |NEEDS_HUMAN|REJECTED|FAILED
  scheduled_at    timestamptz,
  published_at    timestamptz,
  jst_date        date,
  jst_dow         smallint,            -- 0=Sun .. 6=Sat
  jst_slot        text,                -- '06:30'

  theme           text,
  format          text,
  hook_type       text,
  cta_type        text,
  length_bucket   text,                -- s|m|l|xl
  char_count      int,

  body            text,
  target_problem  text,
  goal            text,
  cta_text        text,

  hypothesis_id   uuid references hypotheses(id) on delete set null,
  experiment_id   uuid references experiments(id) on delete set null,
  variant         text,                -- 'A' | 'B'
  arm_key         text,
  selection_mode  text,                -- exploit | explore

  threads_media_id text unique,
  threads_permalink text,
  link_slug       text unique,
  link_destination text,

  debate_rounds   int not null default 0,
  judge_score     numeric,
  ai_cost_usd     numeric not null default 0,

  performance_score      numeric,
  performance_percentile numeric,
  prediction_error       numeric,
  evaluated_at    timestamptz,

  failure_reason  text,
  publish_attempts int not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists posts_status_idx on posts(status);
create index if not exists posts_scheduled_idx on posts(scheduled_at) where status in ('APPROVED','SCHEDULED');
create index if not exists posts_jst_idx on posts(jst_date, jst_slot);
create index if not exists posts_published_idx on posts(published_at desc);
create index if not exists posts_dims_idx on posts(theme, format, hook_type);

-- ============================================================
-- post_metrics: 時点スナップショット
-- ============================================================
create table if not exists post_metrics (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references posts(id) on delete cascade,
  snapshot_at  timestamptz not null default now(),
  horizon      text not null,        -- 1h|6h|24h|manual
  source       text not null,        -- api|manual|csv|estimated

  impressions  int not null default 0,   -- Threads API の views
  likes        int not null default 0,
  replies      int not null default 0,
  reposts      int not null default 0,
  quotes       int not null default 0,
  shares       int not null default 0,

  profile_visits int,                 -- API未提供: 推定 or 手入力
  follows        int,                 -- API未提供: 推定 or 手入力
  link_clicks    int not null default 0, -- 自前リダイレクタで実測

  created_at   timestamptz not null default now(),
  unique (post_id, horizon, source)
);

create index if not exists post_metrics_post_idx on post_metrics(post_id, snapshot_at desc);

-- ============================================================
-- link_clicks: リダイレクタの生ログ
-- ============================================================
create table if not exists link_clicks (
  id         bigserial primary key,
  post_id    uuid references posts(id) on delete cascade,
  slug       text not null,
  clicked_at timestamptz not null default now(),
  referer    text,
  ua_hash    text
);
create index if not exists link_clicks_post_idx on link_clicks(post_id, clicked_at);

-- ============================================================
-- account_daily: アカウント単位の日次（按分の元データ）
-- ============================================================
create table if not exists account_daily (
  jst_date        date primary key,
  views           int,
  likes           int,
  replies         int,
  reposts         int,
  quotes          int,
  profile_visits  int,
  followers_total int,
  follows_delta   int,
  source          text not null default 'api',
  created_at      timestamptz not null default now()
);

-- ============================================================
-- debates: GPT / Claude の議論ログ
-- ============================================================
create table if not exists debates (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references posts(id) on delete cascade,
  round         int not null,
  step          int not null,          -- 実行順 1..5
  agent         text not null,         -- strategist|critic|integrator|challenger|judge
  provider      text not null,         -- openai|anthropic
  model         text not null,
  input_summary jsonb,
  output        jsonb,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cached_input_tokens int not null default 0,
  cost_usd      numeric not null default 0,
  latency_ms    int,
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists debates_post_idx on debates(post_id, round, step);

-- ============================================================
-- judge_scores
-- ============================================================
create table if not exists judge_scores (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references posts(id) on delete cascade,
  round         int not null,
  hook                       numeric not null,
  target_fit                 numeric not null,
  empathy                    numeric not null,
  reply_probability          numeric not null,
  originality                numeric not null,
  profile_visit_probability  numeric not null,
  naturalness                numeric not null,
  total_score   numeric not null,
  approved      boolean not null,
  major_issue   boolean not null,
  unresolved_issues jsonb,
  confidence    numeric,
  created_at    timestamptz not null default now(),
  unique (post_id, round)
);

-- ============================================================
-- winning_patterns: 現在判明している勝ちパターン
-- ============================================================
create table if not exists winning_patterns (
  id           uuid primary key default gen_random_uuid(),
  dimension    text not null,      -- theme|format|hook_type|slot|dow|length_bucket|cta_type|combo
  value        text not null,
  metric       text not null,      -- 評価に使った指標
  mean_score   numeric,            -- 平均 performance_score
  lift         numeric,            -- 全体平均比 (1.0 = 平均)
  sample_n     int not null default 0,
  posterior_alpha numeric not null default 1,
  posterior_beta  numeric not null default 1,
  win_prob     numeric,            -- alpha/(alpha+beta)
  rank         int,
  updated_at   timestamptz not null default now(),
  unique (dimension, value, metric)
);

-- ============================================================
-- weekly_insights
-- ============================================================
create table if not exists weekly_insights (
  id                uuid primary key default gen_random_uuid(),
  week_start        date not null unique,
  posts_analyzed    int not null default 0,
  findings          jsonb,
  next_actions      jsonb,
  next_experiments  jsonb,
  judge_calibration jsonb,
  theme_mix_before  jsonb,
  theme_mix_after   jsonb,
  report_md         text,
  ai_cost_usd       numeric not null default 0,
  created_at        timestamptz not null default now()
);

-- ============================================================
-- threads_auth: OAuth トークン保管（単一アカウント運用）
-- ============================================================
create table if not exists threads_auth (
  id            int primary key default 1,
  user_id       text,
  username      text,
  access_token  text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now(),
  constraint threads_auth_singleton check (id = 1)
);

-- ============================================================
-- KPI view: 各スナップショットの派生指標
-- ============================================================
create or replace view post_metrics_kpi as
select
  m.id,
  m.post_id,
  m.horizon,
  m.source,
  m.snapshot_at,
  m.impressions,
  m.likes, m.replies, m.reposts, m.quotes, m.shares,
  m.profile_visits, m.follows, m.link_clicks,
  nullif(m.impressions, 0)                                              as denom,
  (m.likes + m.replies + m.reposts + m.quotes)::numeric
    / nullif(m.impressions, 0)                                          as engagement_rate,
  m.replies::numeric        / nullif(m.impressions, 0)                  as reply_rate,
  m.likes::numeric          / nullif(m.impressions, 0)                  as like_rate,
  (m.reposts + m.quotes)::numeric / nullif(m.impressions, 0)            as repost_rate,
  m.profile_visits::numeric / nullif(m.impressions, 0)                  as profile_visit_rate,
  m.follows::numeric        / nullif(m.impressions, 0)                  as follow_conversion_rate,
  m.link_clicks::numeric    / nullif(m.impressions, 0)                  as link_ctr
from post_metrics m;

-- 投稿ごとの「確定メトリクス」= 24h > 6h > 1h の優先、
-- ただし手入力(manual)は同一horizonで常にapi/estimatedより優先
create or replace view post_final_metrics as
select distinct on (post_id)
  *
from post_metrics_kpi
order by
  post_id,
  case horizon when '24h' then 3 when 'manual' then 3 when '6h' then 2 when '1h' then 1 else 0 end desc,
  case source  when 'manual' then 3 when 'csv' then 2 when 'api' then 1 else 0 end desc,
  snapshot_at desc;
