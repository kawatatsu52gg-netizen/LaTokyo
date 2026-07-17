"""
SQLite 永続化層（stdlib sqlite3 のみ）。

sources / claims / quizzes の 3 テーブルを持ち、JSON ファイル出力と
二重に保持することで「人が読めるJSON」と「検索できるDB」を両立する。
DB は data/database/quiz.db に置く。
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from .schemas import Source, Claim, Quiz


SCHEMA = """
CREATE TABLE IF NOT EXISTS sources (
    source_id TEXT PRIMARY KEY,
    source_type TEXT,
    title TEXT,
    youtube_url TEXT,
    channel_name TEXT,
    published_at TEXT,
    imported_at TEXT,
    notebook_name TEXT,
    notebook_export_file TEXT,
    content_hash TEXT,
    raw_json TEXT
);
CREATE TABLE IF NOT EXISTS claims (
    claim_id TEXT PRIMARY KEY,
    source_id TEXT,
    statement TEXT,
    topic TEXT,
    anatomical_region TEXT,
    nerve TEXT,
    receptor TEXT,
    stimulus_type TEXT,
    evidence_level TEXT,
    verification_status TEXT,
    raw_json TEXT,
    FOREIGN KEY (source_id) REFERENCES sources(source_id)
);
CREATE TABLE IF NOT EXISTS quizzes (
    quiz_id TEXT PRIMARY KEY,
    chapter INTEGER,
    level INTEGER,
    question TEXT,
    correct_answer TEXT,
    evidence_level TEXT,
    review_status TEXT,
    raw_json TEXT
);
"""


class DB:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # --- sources / claims ---
    def upsert_source(self, s: Source) -> None:
        d = s.to_dict()
        self.conn.execute(
            """INSERT OR REPLACE INTO sources
               (source_id, source_type, title, youtube_url, channel_name,
                published_at, imported_at, notebook_name, notebook_export_file,
                content_hash, raw_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (s.source_id, s.source_type, s.title, s.youtube_url, s.channel_name,
             s.published_at, s.imported_at, s.notebook_name, s.notebook_export_file,
             s.content_hash, json.dumps(d, ensure_ascii=False)),
        )
        for c in s.claims:
            self.upsert_claim(s.source_id, c)
        self.conn.commit()

    def upsert_claim(self, source_id: str, c: Claim) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO claims
               (claim_id, source_id, statement, topic, anatomical_region, nerve,
                receptor, stimulus_type, evidence_level, verification_status, raw_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (c.claim_id, source_id, c.statement, c.topic, c.anatomical_region, c.nerve,
             c.receptor, c.stimulus_type, c.evidence_level, c.verification_status,
             json.dumps(c.to_dict(), ensure_ascii=False)),
        )

    def find_source_by_hash(self, content_hash: str) -> str | None:
        row = self.conn.execute(
            "SELECT source_id FROM sources WHERE content_hash = ?", (content_hash,)
        ).fetchone()
        return row["source_id"] if row else None

    def find_source_by_url(self, url: str) -> str | None:
        if not url:
            return None
        row = self.conn.execute(
            "SELECT source_id FROM sources WHERE youtube_url = ? AND youtube_url != ''",
            (url,),
        ).fetchone()
        return row["source_id"] if row else None

    def get_verified_claims(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT raw_json FROM claims WHERE verification_status = 'verified'"
        ).fetchall()
        return [json.loads(r["raw_json"]) for r in rows]

    def count(self, table: str) -> int:
        return self.conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]

    def next_id(self, table: str, prefix: str, col: str) -> str:
        """既存の最大連番+1で ID を採番する（例: SRC-0007）。"""
        rows = self.conn.execute(f"SELECT {col} FROM {table}").fetchall()
        mx = 0
        for r in rows:
            val = r[col] or ""
            if val.startswith(prefix):
                try:
                    mx = max(mx, int(val.rsplit("-", 1)[-1]))
                except ValueError:
                    pass
        return f"{prefix}{mx + 1:04d}"

    # --- quizzes ---
    def upsert_quiz(self, q: Quiz) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO quizzes
               (quiz_id, chapter, level, question, correct_answer,
                evidence_level, review_status, raw_json)
               VALUES (?,?,?,?,?,?,?,?)""",
            (q.quiz_id, q.chapter, q.level, q.question, q.correct_answer,
             q.evidence_level, q.review_status, json.dumps(q.to_dict(), ensure_ascii=False)),
        )
        self.conn.commit()
