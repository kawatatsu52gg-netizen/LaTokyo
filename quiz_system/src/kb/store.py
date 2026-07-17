"""
Knowledge Base ストア層（SQLite）。

UPSERT中心で冪等。エンティティは別名(alias)で名寄せして重複統合する。
1000本規模でも、必要な行だけを索引経由で取得する（全読み込みしない）。
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable

from .schema import DDL

EVIDENCE_ORDER = {"A": 3, "B": 2, "C": 1, "D": 0}


def evidence_min(levels: Iterable[str]) -> str:
    """複数エビデンスの最小（弱い方）を返す。空なら D。"""
    vals = [EVIDENCE_ORDER.get(l, 0) for l in levels]
    if not vals:
        return "D"
    inv = {v: k for k, v in EVIDENCE_ORDER.items()}
    return inv[min(vals)]


def evidence_max(levels: Iterable[str]) -> str:
    vals = [EVIDENCE_ORDER.get(l, 0) for l in levels]
    if not vals:
        return "D"
    inv = {v: k for k, v in EVIDENCE_ORDER.items()}
    return inv[max(vals)]


def evidence_at_least(level: str, threshold: str) -> bool:
    return EVIDENCE_ORDER.get(level, 0) >= EVIDENCE_ORDER.get(threshold, 0)


class KB:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(DDL)
        self.conn.commit()

    def close(self) -> None:
        self.conn.commit()
        self.conn.close()

    # ---- upserts ----
    def upsert_topic(self, topic_id: str, name: str, parent: str = "", desc: str = "") -> None:
        self.conn.execute(
            "INSERT OR REPLACE INTO topics(topic_id,name,parent_topic_id,description) VALUES(?,?,?,?)",
            (topic_id, name, parent or None, desc),
        )

    def upsert_source(self, d: dict[str, Any]) -> None:
        cols = ["source_id", "source_type", "title", "youtube_url", "channel_name",
                "authors", "journal", "doi", "publisher", "isbn", "edition",
                "published_at", "imported_at", "content_hash", "reliability"]
        vals = [d.get(c, "") for c in cols]
        self.conn.execute(
            f"INSERT OR REPLACE INTO sources({','.join(cols)}) VALUES({','.join('?'*len(cols))})",
            vals,
        )

    def link_topic_source(self, topic_id: str, source_id: str) -> None:
        self.conn.execute(
            "INSERT OR IGNORE INTO topic_sources(topic_id,source_id) VALUES(?,?)",
            (topic_id, source_id))

    def upsert_entity(self, d: dict[str, Any]) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO entities(entity_id,etype,name,reading,latin,topic_id,attributes)
               VALUES(?,?,?,?,?,?,?)""",
            (d["entity_id"], d["etype"], d["name"], d.get("reading", ""), d.get("latin", ""),
             d.get("topic_id") or None, json.dumps(d.get("attributes", {}), ensure_ascii=False)))
        for al in d.get("aliases", []):
            self.conn.execute(
                "INSERT OR IGNORE INTO entity_aliases(alias,entity_id) VALUES(?,?)",
                (al, d["entity_id"]))
        # 正式名も別名として登録（名寄せの起点）
        self.conn.execute(
            "INSERT OR IGNORE INTO entity_aliases(alias,entity_id) VALUES(?,?)",
            (d["name"], d["entity_id"]))

    def resolve_entity(self, name_or_alias: str) -> str | None:
        row = self.conn.execute(
            "SELECT entity_id FROM entity_aliases WHERE alias=?", (name_or_alias,)).fetchone()
        return row["entity_id"] if row else None

    def upsert_claim(self, d: dict[str, Any]) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO claims(claim_id,statement,topic_id,evidence_level,
               verification_status,review_notes,updated_at) VALUES(?,?,?,?,?,?,?)""",
            (d["claim_id"], d["statement"], d.get("topic_id") or None,
             d.get("evidence_level", "D"), d.get("verification_status", "needs_review"),
             d.get("review_notes", ""), d.get("updated_at", "")))
        for s in d.get("sources", []):
            self.conn.execute(
                """INSERT OR REPLACE INTO claim_sources(claim_id,source_id,quote,locator,source_evidence)
                   VALUES(?,?,?,?,?)""",
                (d["claim_id"], s["source_id"], s.get("quote", ""), s.get("locator", ""),
                 s.get("source_evidence", "C")))
        for e in d.get("entities", []):
            eid = e if isinstance(e, str) else e.get("entity_id")
            role = "" if isinstance(e, str) else e.get("role", "")
            if eid:
                self.conn.execute(
                    "INSERT OR REPLACE INTO claim_entities(claim_id,entity_id,role) VALUES(?,?,?)",
                    (d["claim_id"], eid, role))

    def upsert_edge(self, d: dict[str, Any]) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO edges(edge_id,from_entity,relation,to_entity,
               evidence_level,claim_ids,note) VALUES(?,?,?,?,?,?,?)""",
            (d["edge_id"], d["from_entity"], d["relation"], d["to_entity"],
             d.get("evidence_level", "D"), json.dumps(d.get("claim_ids", []), ensure_ascii=False),
             d.get("note", "")))

    def upsert_quiz(self, q: dict[str, Any]) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO quizzes(quiz_id,topic_id,quiz_type,chapter,level,
               evidence_level,review_status,raw_json) VALUES(?,?,?,?,?,?,?,?)""",
            (q["quiz_id"], q.get("topic_id") or None, q.get("quiz_type", "multiple_choice"),
             q.get("chapter"), q.get("level"), q.get("evidence_level", "D"),
             q.get("review_status", "draft"), json.dumps(q, ensure_ascii=False)))

    def commit(self) -> None:
        self.conn.commit()

    # ---- queries ----
    def get_entity(self, entity_id: str) -> dict | None:
        r = self.conn.execute("SELECT * FROM entities WHERE entity_id=?", (entity_id,)).fetchone()
        return dict(r) if r else None

    def entities_by_type(self, etype: str) -> list[dict]:
        return [dict(r) for r in self.conn.execute(
            "SELECT * FROM entities WHERE etype=?", (etype,)).fetchall()]

    def edges_from(self, entity_id: str, relation: str | None = None,
                   min_evidence: str | None = None) -> list[dict]:
        q = "SELECT * FROM edges WHERE from_entity=?"
        args: list[Any] = [entity_id]
        if relation:
            q += " AND relation=?"; args.append(relation)
        rows = [dict(r) for r in self.conn.execute(q, args).fetchall()]
        if min_evidence:
            rows = [r for r in rows if evidence_at_least(r["evidence_level"], min_evidence)]
        return rows

    def all_edges(self, min_evidence: str | None = None,
                  topic_id: str | None = None) -> list[dict]:
        rows = [dict(r) for r in self.conn.execute("SELECT * FROM edges").fetchall()]
        if min_evidence:
            rows = [r for r in rows if evidence_at_least(r["evidence_level"], min_evidence)]
        if topic_id:
            # from か to のどちらかが topic 配下のエンティティであるエッジ
            ids = {r["entity_id"] for r in self.conn.execute(
                "SELECT entity_id FROM entities WHERE topic_id=?", (topic_id,)).fetchall()}
            rows = [r for r in rows if r["from_entity"] in ids or r["to_entity"] in ids]
        return rows

    def claim_source_count(self, claim_id: str) -> int:
        return self.conn.execute(
            "SELECT COUNT(*) AS n FROM claim_sources WHERE claim_id=?", (claim_id,)).fetchone()["n"]

    def sources_for_claim(self, claim_id: str) -> list[dict]:
        return [dict(r) for r in self.conn.execute(
            "SELECT * FROM claim_sources WHERE claim_id=?", (claim_id,)).fetchall()]

    def get_claim(self, claim_id: str) -> dict | None:
        r = self.conn.execute("SELECT * FROM claims WHERE claim_id=?", (claim_id,)).fetchone()
        return dict(r) if r else None

    def count(self, table: str) -> int:
        return self.conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]

    def counts_by(self, table: str, col: str) -> dict[str, int]:
        return {r[col]: r["n"] for r in self.conn.execute(
            f"SELECT {col}, COUNT(*) AS n FROM {table} GROUP BY {col}").fetchall()}
