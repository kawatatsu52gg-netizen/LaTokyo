"""
Dashboard 用の集計。kb.db / quiz.db / 生成ファイルから読み取り専用で数える。
Knowledge Base を唯一の情報源とし、表示はすべて既存データの集計に徹する。
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent  # quiz_system/
KB_DB = ROOT / "data" / "database" / "kb.db"
QUIZ_DB = ROOT / "data" / "database" / "quiz.db"
DATA = ROOT / "data"
CONTENT = DATA / "content"
INBOX = ROOT / "inbox" / "notebooklm_exports"


def _connect(path: Path):
    if not path.exists():
        return None
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    return c


def _load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _kb_counts() -> dict:
    c = _connect(KB_DB)
    if not c:
        return {}
    def one(q, *a):
        try:
            return c.execute(q, a).fetchone()[0]
        except Exception:
            return 0
    out = {
        "topics": one("SELECT COUNT(*) FROM topics"),
        "sources": one("SELECT COUNT(*) FROM sources"),
        "entities": one("SELECT COUNT(*) FROM entities"),
        "claims": one("SELECT COUNT(*) FROM claims"),
        "edges": one("SELECT COUNT(*) FROM edges"),
        "verified": one("SELECT COUNT(*) FROM claims WHERE verification_status='verified'"),
        "needs_review": one("SELECT COUNT(*) FROM claims WHERE verification_status='needs_review'"),
        "rejected": one("SELECT COUNT(*) FROM claims WHERE verification_status='rejected'"),
        "evidence": {},
        "sources_by_type": {},
    }
    for r in c.execute("SELECT evidence_level el, COUNT(*) n FROM claims GROUP BY el"):
        out["evidence"][r["el"]] = r["n"]
    for r in c.execute("SELECT source_type st, COUNT(*) n FROM sources GROUP BY st"):
        out["sources_by_type"][r["st"]] = r["n"]
    c.close()
    return out


def _content_counts() -> dict:
    counts = {"instagram": 0, "slides": 0, "youtube": 0, "total": 0, "subjects": 0}
    if CONTENT.exists():
        subjects = [d for d in CONTENT.iterdir() if d.is_dir()]
        counts["subjects"] = len(subjects)
        for d in subjects:
            for f in d.glob("*.md"):
                counts["total"] += 1
                if f.name == "instagram_carousel.md":
                    counts["instagram"] += 1
                elif f.name == "halii_slide.md":
                    counts["slides"] += 1
                elif f.name == "youtube_script.md":
                    counts["youtube"] += 1
    return counts


def _quiz_counts() -> dict:
    def n(p: Path):
        return len(list(p.glob("*.json"))) if p.exists() else 0
    return {
        "drafts": n(DATA / "quizzes" / "drafts"),
        "approved": n(DATA / "quizzes" / "approved"),
        "rejected": n(DATA / "quizzes" / "rejected"),
        "kb_generated": n(DATA / "quizzes" / "kb_generated"),
    }


def _today_sources() -> int:
    srcs = _load_json(DATA / "sources" / "sources.json", [])
    t = _today()
    return sum(1 for s in srcs if str(s.get("imported_at", "")).startswith(t))


def _unreviewed_claims() -> int:
    """自動抽出され、まだ検証されていない claim（claims.json の needs_review）を数える。"""
    claims = _load_json(DATA / "claims" / "claims.json", [])
    return sum(1 for c in claims if c.get("verification_status") == "needs_review")


def _inbox_pending() -> int:
    """inboxにあるが、まだ sources に取り込まれていない書き出しの数（概算）。"""
    if not INBOX.exists():
        return 0
    files = [p for p in INBOX.iterdir() if p.is_file() and p.suffix.lower() in {".md", ".txt", ".csv", ".pdf"}]
    srcs = _load_json(DATA / "sources" / "sources.json", [])
    imported = {s.get("notebook_export_file") for s in srcs}
    return sum(1 for f in files if f.name not in imported)


def _quality_score() -> dict:
    """quiz_source.json の平均10観点スコア（KB verified を材料に評価）。"""
    try:
        from ..schemas import Quiz
        from ..validation.evaluate import evaluate_quiz
        from ..kb.store import KB
    except Exception:
        return {"avg": 0, "count": 0}
    defs = _load_json(DATA / "quizzes" / "quiz_source.json", [])
    if not defs or not KB_DB.exists():
        return {"avg": 0, "count": 0}
    kb = KB(KB_DB)
    verified = kb.get_verified_claims() if hasattr(kb, "get_verified_claims") else []
    vids = {c["claim_id"] for c in verified}
    cby = {c["claim_id"]: c for c in verified}
    totals = []
    for d in defs:
        try:
            card = evaluate_quiz(Quiz.from_dict(d), vids, cby)
            totals.append(card.total)
        except Exception:
            pass
    kb.close()
    if not totals:
        return {"avg": 0, "count": 0}
    return {"avg": round(sum(totals) / len(totals), 1), "count": len(totals)}


def dashboard_summary() -> dict:
    kb = _kb_counts()
    content = _content_counts()
    quiz = _quiz_counts()
    return {
        "today_videos": _today_sources(),
        "notebooklm_pending": _inbox_pending(),
        "kb_updated": KB_DB.exists(),
        "kb_last_build": datetime.fromtimestamp(KB_DB.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
        if KB_DB.exists() else "-",
        "unreviewed_claims": _unreviewed_claims(),
        "review_quizzes": quiz["drafts"] + quiz["kb_generated"],
        "publish_pending_content": content["total"],
        "instagram": content["instagram"],
        "slides": content["slides"],
        "youtube": content["youtube"],
        "quality": _quality_score(),
        "kb": kb,
        "quiz": quiz,
        "content": content,
    }


def topics() -> list[dict]:
    """テーマ一覧 + テーマ別の 動画/Claim/Evidence/Quiz/Instagram/Slide 数。"""
    c = _connect(KB_DB)
    if not c:
        return []
    rows = c.execute("SELECT topic_id,name,parent_topic_id FROM topics ORDER BY topic_id").fetchall()
    out = []
    for r in rows:
        tid = r["topic_id"]
        # このテーマ＋子テーマ配下
        subs = [tid] + [x["topic_id"] for x in c.execute(
            "SELECT topic_id FROM topics WHERE parent_topic_id=?", (tid,)).fetchall()]
        qm = ",".join("?" * len(subs))
        vids = c.execute(
            f"""SELECT COUNT(DISTINCT s.source_id) n FROM topic_sources ts
                JOIN sources s ON s.source_id=ts.source_id
                WHERE ts.topic_id IN ({qm}) AND s.source_type='youtube'""", subs).fetchone()["n"]
        claims = c.execute(
            f"SELECT COUNT(*) n FROM claims WHERE topic_id IN ({qm})", subs).fetchone()["n"]
        ev = c.execute(
            f"""SELECT COUNT(*) n FROM claims WHERE topic_id IN ({qm})
                AND verification_status='verified' AND evidence_level IN ('A','B')""", subs).fetchone()["n"]
        quiz_n = c.execute(
            f"SELECT COUNT(*) n FROM quizzes WHERE topic_id IN ({qm})", subs).fetchone()["n"]
        # Instagram/Slide は生成ファイルから（テーマ名主題で作られていれば）
        insta = slide = 0
        subj_dir = CONTENT / _safe(r["name"])
        if subj_dir.exists():
            insta = 1 if (subj_dir / "instagram_carousel.md").exists() else 0
            slide = 1 if (subj_dir / "halii_slide.md").exists() else 0
        out.append({
            "topic_id": tid, "name": r["name"], "parent": r["parent_topic_id"],
            "videos": vids, "claims": claims, "evidence_AB": ev,
            "quizzes": quiz_n, "instagram": insta, "slides": slide,
        })
    c.close()
    return out


def _safe(name: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "＿_-" else "_" for ch in name)[:40]


def daily_report() -> dict:
    kb = _kb_counts()
    quiz = _quiz_counts()
    content = _content_counts()
    return {
        "date": _today(),
        "added_videos": _today_sources(),
        "kb_total_claims": kb.get("claims", 0),
        "kb_verified": kb.get("verified", 0),
        "kb_edges": kb.get("edges", 0),
        "claims_needs_review": _unreviewed_claims(),
        "published_quizzes": quiz["approved"],
        "review_pending": quiz["drafts"] + quiz["kb_generated"],
        "content_total": content["total"],
        "quality": _quality_score(),
    }
