"""
品質採点層 (Quality Assurance の定量評価)。

QAの合否(qa.py)とは別に、各クイズを6観点で 0〜5 点で採点し、
合計 /30 と「自動修正が必要か」を返す。

6観点:
  1. medical_accuracy   医学的正確性（エビデンスレベル + 検証済み出典）
  2. clarity            分かりやすさ（設問・選択肢の長さと平易さ）
  3. choice_quality     選択肢の質（長さの均一性・重複なし・禁止パターンなし）
  4. explanation_quality 解説の質（本文と各選択肢説明の充実）
  5. source_traceability 出典追跡性（claim_ids/source_ids/エビデンス）
  6. educational_value  教育的価値（応用・個人差・同意への配慮）

しきい値未満（既定 3.0/5 のいずれか、または合計 < 21/30）は needs_fix=True。
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from ..schemas import Quiz


EVIDENCE_SCORE = {"A": 5.0, "B": 4.0, "C": 3.0, "D": 0.0}
PASS_DIMENSION = 3.0
PASS_TOTAL = 21.0

# 反応・対話・痛みを扱う章では同意・個人差配慮の比重が高い
CONSENT_RELEVANT = {6, 7, 8, 9}
VARIATION_RELEVANT = {3, 4, 6, 7, 8, 9}


@dataclass
class ScoreCard:
    quiz_id: str
    scores: dict[str, float] = field(default_factory=dict)
    total: float = 0.0
    needs_fix: bool = False
    notes: list[str] = field(default_factory=list)


def _len_uniformity(values: list[int]) -> float:
    """選択肢長のばらつきが小さいほど高得点（5.0満点）。"""
    if len(values) < 2:
        return 5.0
    mean = statistics.mean(values)
    if mean == 0:
        return 0.0
    cv = statistics.pstdev(values) / mean  # 変動係数
    # cv 0 -> 5.0, cv 0.5+ -> 0
    return max(0.0, min(5.0, 5.0 - cv * 10))


def score_quiz(q: Quiz) -> ScoreCard:
    sc = ScoreCard(quiz_id=q.quiz_id)

    # 1. medical_accuracy
    acc = EVIDENCE_SCORE.get(q.evidence_level, 0.0)
    if not q.claim_ids:
        acc = min(acc, 1.0)
        sc.notes.append("医学的正確性: 検証済みclaimの紐付けが無い")
    sc.scores["medical_accuracy"] = acc

    # 2. clarity
    clr = 5.0
    qlen = len(q.question)
    if qlen > 120:
        clr -= 1.5; sc.notes.append("分かりやすさ: 設問が長い")
    if qlen < 12:
        clr -= 2.0; sc.notes.append("分かりやすさ: 設問が短すぎる")
    if any(len(v) > 60 for v in q.choices.values()):
        clr -= 1.0; sc.notes.append("分かりやすさ: 長すぎる選択肢がある")
    sc.scores["clarity"] = max(0.0, clr)

    # 3. choice_quality
    lens = [len(v) for v in q.choices.values()]
    cq = _len_uniformity(lens)
    texts = [v.strip() for v in q.choices.values()]
    if len(set(texts)) < 4:
        cq = min(cq, 2.0); sc.notes.append("選択肢の質: 重複する選択肢がある")
    if any(len(v.strip()) == 0 for v in texts):
        cq = 0.0; sc.notes.append("選択肢の質: 空の選択肢がある")
    sc.scores["choice_quality"] = cq

    # 4. explanation_quality
    eq = 5.0
    if len(q.explanation) < 40:
        eq -= 2.0; sc.notes.append("解説の質: 解説本文が薄い")
    empties = [k for k in ("A", "B", "C", "D") if len(q.choice_explanations.get(k, "").strip()) < 6]
    if empties:
        eq -= 1.5 * len(empties)
        sc.notes.append(f"解説の質: 選択肢説明が薄い/空 {empties}")
    sc.scores["explanation_quality"] = max(0.0, eq)

    # 5. source_traceability
    st = 0.0
    if q.claim_ids:
        st += 2.5
    if q.source_ids:
        st += 1.5
    if q.evidence_level in ("A", "B", "C"):
        st += 1.0
    sc.scores["source_traceability"] = min(5.0, st)
    if not q.claim_ids or not q.source_ids:
        sc.notes.append("出典追跡性: claim_ids/source_ids のいずれかが欠落")

    # 6. educational_value
    ev = 2.0
    if q.practical_point.strip():
        ev += 1.0
    if q.individual_variation_note.strip():
        ev += 1.0
    elif q.chapter in VARIATION_RELEVANT:
        sc.notes.append("教育的価値: 個人差の注記が望ましい章で未記載")
    if q.consent_note.strip():
        ev += 1.0
    elif q.chapter in CONSENT_RELEVANT:
        sc.notes.append("教育的価値: 同意・安全の注記が望ましい章で未記載")
    sc.scores["educational_value"] = min(5.0, ev)

    sc.total = round(sum(sc.scores.values()), 1)
    sc.needs_fix = sc.total < PASS_TOTAL or any(v < PASS_DIMENSION for v in sc.scores.values())
    return sc


def scorecard_table(cards: list[ScoreCard]) -> str:
    """Markdown表で採点結果を返す。"""
    header = (
        "| Quiz | 医学的正確性 | 分かりやすさ | 選択肢 | 解説 | 出典追跡 | 教育的価値 | 合計/30 | 要修正 |\n"
        "|---|---|---|---|---|---|---|---|---|"
    )
    rows = [header]
    for c in cards:
        s = c.scores
        rows.append(
            f"| {c.quiz_id} | {s.get('medical_accuracy',0):.1f} | {s.get('clarity',0):.1f} | "
            f"{s.get('choice_quality',0):.1f} | {s.get('explanation_quality',0):.1f} | "
            f"{s.get('source_traceability',0):.1f} | {s.get('educational_value',0):.1f} | "
            f"**{c.total:.1f}** | {'⚠️要修正' if c.needs_fix else '✅'} |"
        )
    return "\n".join(rows)
