"""
Knowledge Base 自然言語（キーワード）検索。
kb.db 横断で 関連動画/Claim/Evidence/Quiz/Slides/Instagram を集める。
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from .stats import KB_DB, CONTENT, _safe, _connect


def search(q: str) -> dict:
    q = (q or "").strip()
    res = {"query": q, "entities": [], "claims": [], "videos": [], "papers_textbooks": [],
           "quizzes": [], "instagram": [], "slides": [], "youtube": []}
    if not q:
        return res
    c = _connect(KB_DB)
    if not c:
        return res
    like = f"%{q}%"

    # エンティティ（別名も）
    ent_rows = c.execute(
        """SELECT DISTINCT e.entity_id, e.name, e.etype FROM entities e
           LEFT JOIN entity_aliases a ON a.entity_id=e.entity_id
           WHERE e.name LIKE ? OR a.alias LIKE ? LIMIT 20""", (like, like)).fetchall()
    res["entities"] = [dict(r) for r in ent_rows]
    ent_ids = [r["entity_id"] for r in ent_rows]

    # Claim: 本文一致 or 一致エンティティに紐づく
    claim_ids = set()
    for r in c.execute("SELECT claim_id FROM claims WHERE statement LIKE ? LIMIT 40", (like,)):
        claim_ids.add(r["claim_id"])
    if ent_ids:
        qm = ",".join("?" * len(ent_ids))
        for r in c.execute(
                f"SELECT DISTINCT claim_id FROM claim_entities WHERE entity_id IN ({qm})", ent_ids):
            claim_ids.add(r["claim_id"])
    claims = []
    ev = []
    src_ids = set()
    for cid in list(claim_ids)[:60]:
        cr = c.execute("SELECT * FROM claims WHERE claim_id=?", (cid,)).fetchone()
        if not cr:
            continue
        srcs = [dict(s) for s in c.execute(
            "SELECT * FROM claim_sources WHERE claim_id=?", (cid,)).fetchall()]
        for s in srcs:
            src_ids.add(s["source_id"])
        item = {"claim_id": cid, "statement": cr["statement"],
                "evidence_level": cr["evidence_level"],
                "verification_status": cr["verification_status"],
                "sources": [s["source_id"] for s in srcs]}
        claims.append(item)
        if cr["verification_status"] == "verified" and cr["evidence_level"] in ("A", "B"):
            ev.append(item)
    res["claims"] = claims[:30]
    res["evidence"] = ev[:30]

    # 関連ソース（動画/論文/教科書）
    # キーワード一致ソース + 上記claimの出典ソース
    for r in c.execute("SELECT source_id FROM sources WHERE title LIKE ?", (like,)):
        src_ids.add(r["source_id"])
    for sid in src_ids:
        sr = c.execute("SELECT * FROM sources WHERE source_id=?", (sid,)).fetchone()
        if not sr:
            continue
        d = dict(sr)
        if d["source_type"] == "youtube":
            res["videos"].append({"source_id": sid, "title": d["title"],
                                  "url": d["youtube_url"], "channel": d["channel_name"]})
        else:
            res["papers_textbooks"].append({"source_id": sid, "type": d["source_type"],
                                            "title": d["title"], "authors": d["authors"]})

    # Quiz（本文は raw_json 内。raw_json一致で拾い、questionを取り出す）
    for r in c.execute(
            "SELECT quiz_id, quiz_type, evidence_level, raw_json FROM quizzes WHERE raw_json LIKE ? LIMIT 30",
            (like,)):
        try:
            rj = json.loads(r["raw_json"])
        except Exception:
            rj = {}
        res["quizzes"].append({"quiz_id": r["quiz_id"], "quiz_type": r["quiz_type"],
                               "evidence_level": r["evidence_level"],
                               "question": rj.get("question", "")})
    c.close()

    # 生成コンテンツ（主題フォルダ名一致 or 本文一致）
    if CONTENT.exists():
        for d in CONTENT.iterdir():
            if not d.is_dir():
                continue
            hit = q in d.name
            for fmt, key in (("instagram_carousel.md", "instagram"),
                             ("halii_slide.md", "slides"),
                             ("youtube_script.md", "youtube")):
                f = d / fmt
                if f.exists():
                    if hit or (q in f.read_text(encoding="utf-8", errors="ignore")):
                        res[key].append({"subject": d.name, "file": str(f.relative_to(CONTENT.parent.parent))})
    return res
