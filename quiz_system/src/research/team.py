"""
Research Team（5役割）— Knowledge Base に「何を追加すべきか」を考える。

  Research Scout      … 不足＋バックログから、各情報源(YouTube/PubMed/Scholar/教科書)の
                        探索クエリ(研究キュー)を提示する。実データ取得は人が行い、
                        結果は NotebookLM 経由でKBへ（SSoT・自動追加はしない）。
  Evidence Reviewer   … 候補claimを A〜D で仮判定し、要人手検証をフラグ。
  Duplicate Checker   … 既にKBに存在する内容を除外（別名・文の一致）。
  Curriculum Planner  … KBを分析し 不足テーマ/Evidence/Quiz と完成度を提示（curriculum.py）。
  Learning Designer   … KB追加後に Quiz/Instagram/Slide/YouTube/Patient を生成（designer.py）。

このモジュールは「増やす」のではなく「提案する」。生成(Designer)だけKBから作る。
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from . import curriculum

ROOT = Path(__file__).resolve().parent.parent.parent
KB_DB = ROOT / "data" / "database" / "kb.db"
BACKLOG = ROOT / "data" / "research" / "backlog.json"
CANDIDATES = ROOT / "data" / "research" / "candidates.json"
REPORT = ROOT / "data" / "research" / "daily_research.md"

EV_ORDER = {"A": 3, "B": 2, "C": 1, "D": 0}


def _load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _kb():
    if not KB_DB.exists():
        return None
    c = sqlite3.connect(str(KB_DB)); c.row_factory = sqlite3.Row
    return c


# ---- Research Scout ----
def scout() -> list[dict]:
    """不足分析＋バックログから研究キューを作る（優先度つき）。"""
    gaps = curriculum.knowledge_gaps()
    backlog = _load(BACKLOG, {}).get("queries", [])
    by_subject = {b["subject"]: b for b in backlog}
    queue: list[dict] = []

    # 1) 未登録テーマは最優先
    for name in gaps["missing_topics"]:
        b = by_subject.get(name, {})
        queue.append({"priority": "高", "subject": name, "reason": "テーマ未登録",
                      "sources": _src(b)})
    # 2) Evidence不足テーマ
    for w in gaps["weak_evidence"]:
        if w["name"] in gaps["missing_topics"]:
            continue
        b = by_subject.get(w["name"], {})
        queue.append({"priority": "中", "subject": w["name"],
                      "reason": f"Evidence不足({w['have']}/{w['want']})", "sources": _src(b)})
    # 3) エンティティ不足（不足概念を明示）
    for e in gaps["entity_gaps"]:
        b = by_subject.get(e["name"], {})
        queue.append({"priority": "中", "subject": e["name"],
                      "reason": "不足概念: " + "、".join(e["missing"][:5]), "sources": _src(b)})
    return queue


def _src(b: dict) -> dict:
    return {
        "youtube": b.get("youtube", "(検索語を設定してください)"),
        "pubmed": b.get("pubmed", "(検索語を設定してください)"),
        "scholar": b.get("scholar", "(検索語を設定してください)"),
        "textbook": b.get("textbook", "(該当章を設定してください)"),
    }


# ---- Duplicate Checker ----
def _norm(s: str) -> str:
    import re
    return re.sub(r"[\s　。、,.\(\)（）]", "", s or "")[:40]


def dedup(candidates: list[dict]) -> list[dict]:
    """候補が既にKBに存在するかを判定して new/duplicate を付す。"""
    c = _kb()
    existing = []
    if c:
        existing = [_norm(r["statement"]) for r in c.execute("SELECT statement FROM claims")]
        c.close()
    out = []
    for cand in candidates:
        key = _norm(cand["statement"])
        dup = any(key and (key in e or e in key) for e in existing)
        d = dict(cand)
        d["status"] = "duplicate" if dup else "new"
        out.append(d)
    return out


# ---- Evidence Reviewer ----
def review_evidence(candidates: list[dict]) -> list[dict]:
    """候補claimの仮Evidenceを、提案ソースの信頼度から推定。要人手検証をフラグ。"""
    out = []
    for cand in candidates:
        levels = [s.get("reliability", "C") for s in cand.get("proposed_sources", [])]
        base = max(levels, key=lambda x: EV_ORDER.get(x, 0)) if levels else "D"
        # 複数の信頼できるソースがあれば1段引き上げ（上限A）
        strong = sum(1 for l in levels if EV_ORDER.get(l, 0) >= 2)
        if strong >= 2:
            bump = {"D": "C", "C": "B", "B": "A", "A": "A"}
            base = bump[base]
        d = dict(cand)
        d["tentative_evidence"] = base
        d["needs_human_verification"] = True  # 最終確定は Medical Evidence Reviewer(人)
        out.append(d)
    return out


# ---- Curriculum Planner (委譲) ----
def plan() -> dict:
    return {
        "completeness": curriculum.analyze()["overall_completeness"],
        "gaps": curriculum.knowledge_gaps(),
        "evidence_coverage": curriculum.evidence_coverage(),
        "learning_progress": curriculum.learning_progress(),
    }


# ---- 日次研究ラン ----
def run_daily() -> dict:
    p = plan()
    cands = _load(CANDIDATES, [])
    reviewed = review_evidence(dedup(cands))
    queue = scout()
    result = {
        "completeness": p["completeness"],
        "gaps": p["gaps"],
        "evidence_coverage": p["evidence_coverage"],
        "learning_progress": p["learning_progress"],
        "scout_queue": queue,
        "candidates": reviewed,
    }
    _write_report(result)
    return result


def _write_report(r: dict) -> None:
    L = ["# Daily Research Report（Research Team）", "",
         f"## Knowledge Base 完成度: {r['completeness']}%", "",
         "## Knowledge Gap"]
    g = r["gaps"]
    L.append(f"- 未登録テーマ: {', '.join(g['missing_topics']) or 'なし'}")
    L.append("- Evidence不足: " + (", ".join(f"{x['name']}({x['have']}/{x['want']})"
             for x in g["weak_evidence"]) or "なし"))
    L.append("- Quiz不足: " + (", ".join(f"{x['name']}({x['have']}/{x['want']})"
             for x in g["quiz_gaps"]) or "なし"))
    L += ["", "## Evidence Coverage",
          f"- 検証済みA/B割合: {r['evidence_coverage'].get('ab_ratio',0)}%  分布: {r['evidence_coverage'].get('overall',{})}"]
    L += ["", "## Research Scout キュー（探すべき対象・情報源別クエリ）"]
    for q in r["scout_queue"]:
        L.append(f"### [{q['priority']}] {q['subject']} — {q['reason']}")
        for k in ("youtube", "pubmed", "scholar", "textbook"):
            L.append(f"- {k}: {q['sources'][k]}")
    L += ["", "## 候補claim（Evidence仮判定＋重複チェック）"]
    for cand in r["candidates"]:
        L.append(f"- [{cand['status']}] Evidence{cand.get('tentative_evidence','?')} "
                 f"（要人手検証）: {cand['statement']}")
    L += ["", "> 注: Research Team は提案のみ。KBへの追加は人が NotebookLM→検証→KB の流れで行う（SSoT）。"]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(L), encoding="utf-8")
