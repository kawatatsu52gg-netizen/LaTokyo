"""
Knowledge Base スキーマ（SQLite・正規化・1000本以上を想定）。

設計方針:
  - テーマ(topic)を中心に、複数の情報源(source: youtube/paper/textbook)を紐づける。
  - 医学的主張(claim)は複数ソースに支えられる（Evidence統合＝claim_sources多対多）。
  - claim は複数のエンティティ(entity: anatomy/nerve/receptor/muscle/hormone/clinical…)を参照する
    （claim_entities多対多）。
  - ナレッジグラフはエンティティ間の有向エッジ(edges)で表現し、各エッジに evidence_level と
    裏付け claim を持たせる。
  - すべて連番IDではなく安定キー（source_id/entity_id/claim_id）で参照し、UPSERTで冪等。
  - 主要な検索列にインデックスを張り、テーマ/エビデンス/種別での絞り込みを高速化。

スケール指針: この正規化スキーマはそのまま PostgreSQL へ移行可能（型・制約はほぼ共通）。
"""
from __future__ import annotations

DDL = """
PRAGMA journal_mode=WAL;          -- 同時読み取りに強い
PRAGMA foreign_keys=ON;

-- テーマ（階層: 親トピック→サブトピック）
CREATE TABLE IF NOT EXISTS topics (
    topic_id       TEXT PRIMARY KEY,      -- 例: TOP-genital
    name           TEXT NOT NULL,
    parent_topic_id TEXT,                 -- サブトピックは親を持つ
    description    TEXT DEFAULT '',
    FOREIGN KEY (parent_topic_id) REFERENCES topics(topic_id)
);

-- 情報源（動画・論文・教科書を統合）
CREATE TABLE IF NOT EXISTS sources (
    source_id     TEXT PRIMARY KEY,       -- SRC-0001 / PAP-0001 / TXT-0001
    source_type   TEXT NOT NULL,          -- youtube | paper | textbook
    title         TEXT NOT NULL,
    -- youtube用
    youtube_url   TEXT DEFAULT '',
    channel_name  TEXT DEFAULT '',
    -- paper用
    authors       TEXT DEFAULT '',
    journal       TEXT DEFAULT '',
    doi           TEXT DEFAULT '',
    -- textbook用
    publisher     TEXT DEFAULT '',
    isbn          TEXT DEFAULT '',
    edition       TEXT DEFAULT '',
    published_at  TEXT DEFAULT '',
    imported_at   TEXT DEFAULT '',
    content_hash  TEXT DEFAULT '',
    reliability   TEXT DEFAULT 'C'        -- ソース自体の信頼度の目安 A/B/C/D
);

-- テーマ↔ソース（多対多）: 「女性器」に動画/論文/教科書がぶら下がる
CREATE TABLE IF NOT EXISTS topic_sources (
    topic_id  TEXT NOT NULL,
    source_id TEXT NOT NULL,
    PRIMARY KEY (topic_id, source_id),
    FOREIGN KEY (topic_id) REFERENCES topics(topic_id),
    FOREIGN KEY (source_id) REFERENCES sources(source_id)
);

-- エンティティ（知識ノード）
CREATE TABLE IF NOT EXISTS entities (
    entity_id   TEXT PRIMARY KEY,         -- ENT-0001
    etype       TEXT NOT NULL,            -- topic|anatomy|nerve|receptor|muscle|hormone|
                                          -- clinical|spinal_segment|autonomic|stimulus
    name        TEXT NOT NULL,            -- 正式名称（正規化後）
    reading     TEXT DEFAULT '',
    latin       TEXT DEFAULT '',
    topic_id    TEXT,                     -- 主に属するテーマ
    attributes  TEXT DEFAULT '{}',        -- JSON（機能・位置など）
    FOREIGN KEY (topic_id) REFERENCES topics(topic_id)
);

-- エンティティ別名（俗称→正式名の名寄せ・重複統合）
CREATE TABLE IF NOT EXISTS entity_aliases (
    alias      TEXT NOT NULL,
    entity_id  TEXT NOT NULL,
    PRIMARY KEY (alias, entity_id),
    FOREIGN KEY (entity_id) REFERENCES entities(entity_id)
);

-- 医学的主張
CREATE TABLE IF NOT EXISTS claims (
    claim_id      TEXT PRIMARY KEY,       -- CLM-1001
    statement     TEXT NOT NULL,
    topic_id      TEXT,
    evidence_level TEXT DEFAULT 'D',      -- A/B/C/D（統合後の最終評価）
    verification_status TEXT DEFAULT 'needs_review', -- verified|needs_review|rejected
    review_notes  TEXT DEFAULT '',
    updated_at    TEXT DEFAULT '',
    FOREIGN KEY (topic_id) REFERENCES topics(topic_id)
);

-- claim↔source（多対多・Evidence統合）: 1つの主張を複数ソースが支持
CREATE TABLE IF NOT EXISTS claim_sources (
    claim_id    TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    quote       TEXT DEFAULT '',          -- 該当ソースからの引用
    locator     TEXT DEFAULT '',          -- 動画=タイムスタンプ / 論文=頁/図 / 教科書=章頁
    source_evidence TEXT DEFAULT 'C',     -- このソース単独での強さ
    PRIMARY KEY (claim_id, source_id),
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id),
    FOREIGN KEY (source_id) REFERENCES sources(source_id)
);

-- claim↔entity（多対多）: 主張がどのエンティティに関するか
CREATE TABLE IF NOT EXISTS claim_entities (
    claim_id   TEXT NOT NULL,
    entity_id  TEXT NOT NULL,
    role       TEXT DEFAULT '',           -- subject|object など任意
    PRIMARY KEY (claim_id, entity_id),
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id),
    FOREIGN KEY (entity_id) REFERENCES entities(entity_id)
);

-- ナレッジグラフのエッジ（有向・関係型付き・エビデンス付き）
CREATE TABLE IF NOT EXISTS edges (
    edge_id     TEXT PRIMARY KEY,         -- EDG-0001
    from_entity TEXT NOT NULL,
    relation    TEXT NOT NULL,            -- innervated_by|branch_of|originates_from|
                                          -- autonomic_type|homolog_of|located_in|responds_to|
                                          -- contracts_in|associated_with|has_subtopic|part_of|
                                          -- secreted_by|regulates
    to_entity   TEXT NOT NULL,
    evidence_level TEXT DEFAULT 'D',
    claim_ids   TEXT DEFAULT '[]',        -- JSON配列（裏付けclaim）
    note        TEXT DEFAULT '',
    FOREIGN KEY (from_entity) REFERENCES entities(entity_id),
    FOREIGN KEY (to_entity) REFERENCES entities(entity_id)
);

-- 生成クイズ（グラフ由来を含む）
CREATE TABLE IF NOT EXISTS quizzes (
    quiz_id     TEXT PRIMARY KEY,
    topic_id    TEXT,
    quiz_type   TEXT DEFAULT 'multiple_choice', -- fill_blank|multiple_choice|application|case
    chapter     INTEGER,
    level       INTEGER,
    evidence_level TEXT DEFAULT 'D',
    review_status  TEXT DEFAULT 'draft',
    raw_json    TEXT NOT NULL,
    FOREIGN KEY (topic_id) REFERENCES topics(topic_id)
);

-- インデックス（テーマ/種別/エビデンスでの絞り込みを高速化）
CREATE INDEX IF NOT EXISTS idx_sources_type    ON sources(source_type);
CREATE INDEX IF NOT EXISTS idx_entities_type   ON entities(etype);
CREATE INDEX IF NOT EXISTS idx_entities_topic  ON entities(topic_id);
CREATE INDEX IF NOT EXISTS idx_claims_topic    ON claims(topic_id);
CREATE INDEX IF NOT EXISTS idx_claims_ev       ON claims(evidence_level);
CREATE INDEX IF NOT EXISTS idx_claims_status   ON claims(verification_status);
CREATE INDEX IF NOT EXISTS idx_cs_source       ON claim_sources(source_id);
CREATE INDEX IF NOT EXISTS idx_ce_entity       ON claim_entities(entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_from      ON edges(from_entity);
CREATE INDEX IF NOT EXISTS idx_edges_to        ON edges(to_entity);
CREATE INDEX IF NOT EXISTS idx_edges_rel       ON edges(relation);
CREATE INDEX IF NOT EXISTS idx_edges_ev        ON edges(evidence_level);
CREATE INDEX IF NOT EXISTS idx_quizzes_topic   ON quizzes(topic_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_type    ON quizzes(quiz_type);
CREATE INDEX IF NOT EXISTS idx_quizzes_ev      ON quizzes(evidence_level);
"""
