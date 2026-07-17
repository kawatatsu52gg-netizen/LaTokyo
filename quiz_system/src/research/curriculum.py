"""
Curriculum Planner（不足分析＋完成度）。

目標設計図 data/research/curriculum.json と 実 kb.db を比較し、
  - 不足テーマ / 不足エンティティ / 不足Evidence / 不足Quiz
  - Evidence Coverage（A/B検証済みの割合）
  - Learning Progress（テーマ別のQuiz/コンテンツ達成）
  - 完成度 0〜100%
を算出する。KBを増やさず「何が足りないか」を示す分析役。
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
KB_DB = ROOT / "data" / "database" / "kb.db"
CONTENT = ROOT / "data" / "content"
QUIZZES = ROOT / "data" / "quizzes"
CURRICULUM = ROOT / "data" / "research" / "curriculum.json"


def _load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _kb():
    if not KB_DB.exists():
        return None
    c = sqlite3.connect(str(KB_DB))
    c.row_factory = sqlite3.Row
    return c


def _entity_present(c, name: str) -> bool:
    r = c.execute("SELECT 1 FROM entity_aliases WHERE alias=? LIMIT 1", (name,)).fetchone()
    return bool(r)


def _quiz_topic_counts() -> dict[str, int]:
    """quiz_source + kb_generated のクイズを claim→topic で集計。"""
    counts: dict[str, int] = {}
    c = _kb()
    claim_topic = {}
    if c:
        for r in c.execute("SELECT claim_id, topic_id FROM claims"):
            claim_topic[r["claim_id"]] = r["topic_id"]
        c.close()
    files = []
    qs = QUIZZES / "quiz_source.json"
    if qs.exists():
        files += _load(qs, [])
    for folder in ("kb_generated", "drafts", "approved"):
        d = QUIZZES / folder
        if d.exists():
            for f in d.glob("*.json"):
                files.append(_load(f, {}))
    for q in files:
        tid = None
        for cid in q.get("claim_ids", []) or []:
            if cid in claim_topic:
                tid = claim_topic[cid]
                break
        if tid:
            counts[tid] = counts.get(tid, 0) + 1
    return counts


def _safe(name: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "＿_-" else "_" for ch in name)[:40]


def analyze() -> dict:
    cur = _load(CURRICULUM, {"targets": [], "weights": {}})
    w = cur.get("weights", {"entities": .35, "evidence": .30, "quizzes": .20, "content": .15})
    c = _kb()
    quiz_counts = _quiz_topic_counts()

    topics_out = []
    total_score = 0.0
    for t in cur.get("targets", []):
        tid = t["topic_id"]
        # KBにトピックが存在するか
        topic_exists = False
        verified_ab = 0
        if c:
            topic_exists = bool(c.execute(
                "SELECT 1 FROM topics WHERE topic_id=?", (tid,)).fetchone())
            verified_ab = c.execute(
                """SELECT COUNT(*) FROM claims WHERE topic_id=?
                   AND verification_status='verified' AND evidence_level IN ('A','B')""",
                (tid,)).fetchone()[0]
        # エンティティ達成
        want_ent = t.get("target_entities", [])
        have_ent = [e for e in want_ent if c and _entity_present(c, e)]
        miss_ent = [e for e in want_ent if e not in have_ent]
        ent_cov = len(have_ent) / len(want_ent) if want_ent else 1.0
        # Evidence達成
        tev = t.get("target_evidence_claims", 0)
        ev_cov = min(1.0, verified_ab / tev) if tev else 1.0
        # Quiz達成
        tq = t.get("target_quizzes", 0)
        have_q = quiz_counts.get(tid, 0)
        q_cov = min(1.0, have_q / tq) if tq else 1.0
        # コンテンツ達成（テーマ名フォルダの形式）
        want_f = t.get("target_formats", [])
        subj_dir = CONTENT / _safe(t["name"])
        have_f = [f for f in want_f if (subj_dir / f"{f}.md").exists()]
        c_cov = len(have_f) / len(want_f) if want_f else 1.0

        score = (w["entities"] * ent_cov + w["evidence"] * ev_cov +
                 w["quizzes"] * q_cov + w["content"] * c_cov) * 100
        if not topic_exists:
            score *= 0.3  # トピック未登録は大幅減点
        total_score += score
        topics_out.append({
            "topic_id": tid, "name": t["name"], "exists": topic_exists,
            "completeness": round(score, 1),
            "entities": {"have": len(have_ent), "want": len(want_ent), "missing": miss_ent},
            "evidence": {"have": verified_ab, "want": tev},
            "quizzes": {"have": have_q, "want": tq},
            "content": {"have": have_f, "want": want_f, "missing": [f for f in want_f if f not in have_f]},
        })
    if c:
        c.close()
    overall = round(total_score / len(topics_out), 1) if topics_out else 0.0
    return {"overall_completeness": overall, "topics": topics_out}


def knowledge_gaps() -> dict:
    a = analyze()
    missing_topics = [t["name"] for t in a["topics"] if not t["exists"]]
    weak_evidence = [{"name": t["name"], "have": t["evidence"]["have"], "want": t["evidence"]["want"]}
                     for t in a["topics"] if t["evidence"]["have"] < t["evidence"]["want"]]
    quiz_gaps = [{"name": t["name"], "have": t["quizzes"]["have"], "want": t["quizzes"]["want"]}
                 for t in a["topics"] if t["quizzes"]["have"] < t["quizzes"]["want"]]
    entity_gaps = [{"name": t["name"], "missing": t["entities"]["missing"]}
                   for t in a["topics"] if t["entities"]["missing"]]
    return {"missing_topics": missing_topics, "weak_evidence": weak_evidence,
            "quiz_gaps": quiz_gaps, "entity_gaps": entity_gaps}


def evidence_coverage() -> dict:
    """KB全体と主要テーマの Evidence 分布・A/B検証済み割合。"""
    c = _kb()
    if not c:
        return {"overall": {}, "ab_ratio": 0}
    dist = {r["el"]: r["n"] for r in c.execute(
        "SELECT evidence_level el, COUNT(*) n FROM claims WHERE verification_status='verified' GROUP BY el")}
    total = sum(dist.values()) or 1
    ab = dist.get("A", 0) + dist.get("B", 0)
    c.close()
    return {"overall": dist, "ab_ratio": round(ab / total * 100, 1),
            "verified_total": total}


def learning_progress() -> dict:
    """テーマ別のQuiz達成率（Learning Progressの土台）。"""
    a = analyze()
    rows = []
    for t in a["topics"]:
        want = t["quizzes"]["want"] or 1
        rows.append({"name": t["name"], "have": t["quizzes"]["have"],
                     "want": t["quizzes"]["want"],
                     "pct": round(min(1.0, t["quizzes"]["have"] / want) * 100)})
    done = sum(r["have"] for r in rows)
    want = sum(r["want"] for r in rows) or 1
    return {"overall_pct": round(min(1.0, done / want) * 100), "topics": rows}
