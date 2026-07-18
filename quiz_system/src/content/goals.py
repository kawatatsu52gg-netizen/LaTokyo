"""
最終ゴール（卒業6能力）への貢献度監査。

すべてのクイズ・生成コンテンツが、教材の最終ゴールに貢献しているかを機械的に確認する。
  - 各コンテンツが 6能力(G1〜G6) のどれに触れているかをキーワードで判定
  - 貢献ゼロの項目を「非貢献」として洗い出す（修正/削除の対象）
  - 学習者向けコンテンツは G2(個人差)・G6(思いやり) を必須とする
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
GOALS = ROOT / "data" / "goals.json"
QUIZZES = ROOT / "data" / "quizzes"
CONTENT = ROOT / "data" / "content"


def _load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def goals_def() -> dict:
    return _load(GOALS, {"graduation_competencies": [], "audit": {}})


def competencies_hit(text: str, comps: list[dict]) -> list[str]:
    hit = []
    for c in comps:
        if any(sig in text for sig in c["signals"]):
            hit.append(c["id"])
    return hit


def _quiz_text(q: dict) -> str:
    parts = [q.get("question", ""), q.get("explanation", "")]
    parts += list((q.get("choices") or {}).values())
    parts += list((q.get("choice_explanations") or {}).values())
    parts += [q.get("individual_variation_note", ""), q.get("consent_note", ""),
              q.get("practical_point", ""), q.get("needs_verification", "")]
    return " ".join(p for p in parts if p)


def audit() -> dict:
    g = goals_def()
    comps = g["graduation_competencies"]
    cfg = g.get("audit", {})
    required = set(cfg.get("learner_facing_required", []))
    coverage = {c["id"]: 0 for c in comps}
    items = []
    flagged = []

    # --- quizzes（手書き＋グラフ生成＋承認済み）---
    for folder, learner in (("quiz_source", False), ("kb_generated", False),
                            ("approved", False), ("drafts", False)):
        if folder == "quiz_source":
            defs = _load(QUIZZES / "quiz_source.json", [])
            src_items = [(q.get("quiz_id"), q) for q in defs]
        else:
            d = QUIZZES / folder
            src_items = [(f.stem, _load(f, {})) for f in d.glob("*.json")] if d.exists() else []
        for qid, q in src_items:
            hits = competencies_hit(_quiz_text(q), comps)
            for h in hits:
                coverage[h] += 1
            rec = {"kind": "quiz", "id": qid, "where": folder, "hits": hits}
            items.append(rec)
            if len(hits) < cfg.get("min_competencies_per_item", 1):
                flagged.append({**rec, "reason": "どのゴールにも触れていない"})

    # --- 生成コンテンツ（.md） ---
    if CONTENT.exists():
        for f in CONTENT.rglob("*.md"):
            txt = f.read_text(encoding="utf-8", errors="ignore")
            hits = competencies_hit(txt, comps)
            for h in hits:
                coverage[h] += 1
            learner = f.name in ("beginner.md", "empathy.md") or f.parent.name == "beginner"
            rec = {"kind": "content", "id": str(f.relative_to(CONTENT)), "where": "content",
                   "hits": hits, "learner_facing": learner}
            items.append(rec)
            if not hits:
                flagged.append({**rec, "reason": "どのゴールにも触れていない"})
            elif learner and not required.issubset(set(hits)):
                miss = sorted(required - set(hits))
                flagged.append({**rec, "reason": f"学習者向け必須の未充足: {miss}"})

    # --- 学習者が実際に遊ぶ初心者ゲームのクイズ（実行時に平易化＋尊重注記が付く）---
    try:
        from .beginner import build_course
        for lv in build_course()["levels"]:
            for bq in lv["quizzes"]:
                txt = " ".join([bq.get("question", ""), bq.get("explain", ""),
                                bq.get("one_point", ""), bq.get("respect_note", "")]
                               + list((bq.get("choices") or {}).values()))
                hits = competencies_hit(txt, comps)
                rec = {"kind": "game_quiz", "id": bq.get("id"), "where": "beginner_game",
                       "hits": hits, "learner_facing": True}
                items.append(rec)
                if not required.issubset(set(hits)):
                    miss = sorted(required - set(hits))
                    flagged.append({**rec, "reason": f"学習者向け必須の未充足: {miss}"})
    except Exception:
        pass

    total = len(items)
    aligned = total - len([x for x in flagged if x["reason"] == "どのゴールにも触れていない"])
    return {
        "mission": g.get("mission", ""),
        "competency_coverage": coverage,
        "total_items": total,
        "aligned_items": aligned,
        "alignment_pct": round(aligned / total * 100, 1) if total else 100.0,
        "flagged": flagged,
        "competencies": [{"id": c["id"], "name": c["name"]} for c in comps],
    }
