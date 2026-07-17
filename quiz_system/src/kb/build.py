"""
KB ビルダー: 各種シード/既存データを Knowledge Base(kb.db) に統合する。

取り込み元:
  - data/kb/topics.json          テーマ階層
  - data/sources/sources.json    既存YouTubeソース(取り込み済み)
  - data/kb/sources_extra.json   論文・教科書ソース
  - data/kb/topic_sources.json   テーマ↔ソース紐付
  - data/kb/entities.json        エンティティ(ノード)
  - data/kb/edges.json           ナレッジグラフ(エッジ)
  - data/claims/verified_claims.json / rejected_claims.json / data/kb/kb_claims.json  主張

冪等: 何度実行しても UPSERT で同じ状態に収束する。
"""
from __future__ import annotations

import json
from pathlib import Path

from .store import KB, evidence_min

ROOT = Path(__file__).resolve().parent.parent.parent  # quiz_system/


def _load(path: Path):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return []


def build(kb_path: Path | None = None, log=print) -> dict:
    kb_path = kb_path or (ROOT / "data" / "database" / "kb.db")
    kb = KB(kb_path)
    stats = {}

    # 1. topics
    for t in _load(ROOT / "data/kb/topics.json"):
        kb.upsert_topic(t["topic_id"], t["name"], t.get("parent", ""), t.get("description", ""))

    # 2. sources: 既存YouTube + 論文/教科書
    yt = _load(ROOT / "data/sources/sources.json")
    for s in yt:
        kb.upsert_source({
            "source_id": s["source_id"], "source_type": s.get("source_type", "youtube"),
            "title": s.get("title", ""), "youtube_url": s.get("youtube_url", ""),
            "channel_name": s.get("channel_name", ""), "published_at": s.get("published_at", ""),
            "imported_at": s.get("imported_at", ""), "content_hash": s.get("content_hash", ""),
            "reliability": "B",
        })
    for s in _load(ROOT / "data/kb/sources_extra.json"):
        kb.upsert_source(s)

    # 3. topic_sources
    for m in _load(ROOT / "data/kb/topic_sources.json"):
        kb.link_topic_source(m["topic_id"], m["source_id"])

    # 4. entities
    for e in _load(ROOT / "data/kb/entities.json"):
        kb.upsert_entity(e)

    # 5. claims: verified(既存) + rejected + kb_claims
    #    既存 verified_claims.json は source_id を単一フィールドで持つので sources[] に正規化。
    for c in _load(ROOT / "data/claims/verified_claims.json"):
        kb.upsert_claim(_normalize_legacy_claim(c, "verified"))
    for c in _load(ROOT / "data/claims/rejected_claims.json"):
        kb.upsert_claim(_normalize_legacy_claim(c, "rejected"))
    for c in _load(ROOT / "data/kb/kb_claims.json"):
        kb.upsert_claim(c)

    # 6. edges（裏付けclaimのエビデンスと整合を検査してから登録）
    edge_warn = 0
    for e in _load(ROOT / "data/kb/edges.json"):
        # エッジのevidenceは裏付けclaimの最小エビデンスを上限とする（過大評価を防ぐ）
        cids = e.get("claim_ids", [])
        claim_levels = []
        for cid in cids:
            cl = kb.get_claim(cid)
            if cl and cl["verification_status"] == "verified":
                claim_levels.append(cl["evidence_level"])
        if cids and claim_levels:
            capped = evidence_min([e.get("evidence_level", "D"), evidence_min(claim_levels)])
            if capped != e.get("evidence_level"):
                log(f"kb-build: {e['edge_id']} のevidenceを裏付けclaimに合わせ {e['evidence_level']}→{capped} に補正")
                e["evidence_level"] = capped
        elif cids and not claim_levels:
            log(f"kb-build 警告: {e['edge_id']} の裏付けclaimがverifiedでない→evidenceをDに")
            e["evidence_level"] = "D"; edge_warn += 1
        kb.upsert_edge(e)

    kb.commit()
    stats = {
        "topics": kb.count("topics"),
        "sources": kb.count("sources"),
        "sources_by_type": kb.counts_by("sources", "source_type"),
        "entities": kb.count("entities"),
        "entities_by_type": kb.counts_by("entities", "etype"),
        "claims": kb.count("claims"),
        "claims_by_evidence": kb.counts_by("claims", "evidence_level"),
        "edges": kb.count("edges"),
        "edges_by_evidence": kb.counts_by("edges", "evidence_level"),
        "edge_warnings": edge_warn,
    }
    kb.close()
    return stats


def _normalize_legacy_claim(c: dict, default_status: str) -> dict:
    """旧形式(単一source_id+source_quote)を KB claim 形式(sources[])へ。"""
    if "sources" in c:
        return c
    sources = []
    if c.get("source_id"):
        sources.append({
            "source_id": c["source_id"],
            "quote": c.get("source_quote", ""),
            "locator": c.get("timestamp", ""),
            "source_evidence": c.get("evidence_level", "C"),
        })
    return {
        "claim_id": c["claim_id"], "statement": c["statement"],
        "topic_id": c.get("topic_id"), "evidence_level": c.get("evidence_level", "D"),
        "verification_status": c.get("verification_status", default_status),
        "review_notes": c.get("review_notes", ""),
        "sources": sources, "entities": [],
    }
