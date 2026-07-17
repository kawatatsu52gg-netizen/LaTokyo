"""
承認前レビュー評価器（10観点・各10点=合計100点）。

score.py（6観点/30点の内部QA採点）とは別に、ユーザーレビュー用の
10観点ルーブリックを実装する。総合 < 85 は要修正、重大な問題
（医学的欠陥/出典不足/正解の曖昧さ）は reject 判定を返す。

10観点:
  1. medical_accuracy       医学的正確性
  2. clarity                問題文の分かりやすさ
  3. single_answer          正解が一つに限定されているか
  4. choice_naturalness     選択肢の自然さ
  5. explanation_value      解説の教育的価値
  6. traceability           出典追跡性
  7. male_education_fit      男性向け教育コンテンツとしての適切さ
  8. no_generalization      女性を一括りにしていないか
  9. not_technique_biased   性的テクニック偏重になっていないか
 10. consent_communication  相互理解・同意・コミュニケーションの尊重
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from ..schemas import Quiz
from .qa import qa_quiz

PASS_TOTAL = 85

EVIDENCE_ACC = {"A": 10.0, "B": 9.0, "C": 7.0, "D": 0.0}

# 性的テクニック偏重を示唆する語
TECHNIQUE_TERMS = ["攻める", "責める", "感じさせる方法", "感じさせるテクニック",
                   "イカせる", "テクニック", "こうすれば感じ", "落とす方法"]
# 煽情的トーン
AROUSAL_TERMS = ["エロ", "気持ちよくさせる方法"]
# 断定・一括り
ABSOLUTE_TERMS = ["必ず感じる", "全員が", "誰でも必ず", "絶対に", "すべての女性が", "女性は皆"]

CONSENT_CHAPTERS = {6, 7, 8, 9}
VARIATION_CHAPTERS = {3, 4, 6, 7, 8, 9}
DIALOGUE_HINTS = ["対話", "相互", "コミュニケーション", "安心", "同意", "話し合", "確かめ", "急かさ"]


@dataclass
class EvalCard:
    quiz_id: str
    dims: dict[str, float] = field(default_factory=dict)
    total: float = 0.0
    verdict: str = "ok"        # ok | fix | reject
    issues: list[str] = field(default_factory=list)


def _clamp(x: float) -> float:
    return max(0.0, min(10.0, round(x, 1)))


def evaluate_quiz(q: Quiz, verified_ids: set[str], claims_by_id: dict[str, dict]) -> EvalCard:
    c = EvalCard(quiz_id=q.quiz_id)
    qa = qa_quiz(q)
    authoritative = " ".join([q.question, q.explanation,
                              q.choices.get(q.correct_answer, ""),
                              *q.choice_explanations.values()])

    # 1. 医学的正確性
    acc = EVIDENCE_ACC.get(q.evidence_level, 0.0)
    if not q.claim_ids or any(cid not in verified_ids for cid in q.claim_ids):
        acc = min(acc, 3.0); c.issues.append("医学的正確性: 検証済みclaim未紐付")
    c.dims["medical_accuracy"] = _clamp(acc)

    # 2. 分かりやすさ
    clr = 10.0
    if len(q.question) > 90:
        clr -= 2; c.issues.append("分かりやすさ: 設問が長い")
    if any(len(v) > 40 for v in q.choices.values()):
        clr -= 2; c.issues.append("分かりやすさ: 選択肢が長い")
    c.dims["clarity"] = _clamp(clr)

    # 3. 正解が一つに限定
    c.dims["single_answer"] = 10.0 if (q.correct_answer in q.choices and qa.publishable) else 2.0
    if q.correct_answer not in q.choices:
        c.issues.append("正解の曖昧さ: correct_answerが選択肢に無い")

    # 4. 選択肢の自然さ（長さの均一性＋重複なし＋極端な短さなし）
    lens = [len(v) for v in q.choices.values()]
    mean = statistics.mean(lens) if lens else 0
    cv = (statistics.pstdev(lens) / mean) if mean else 1
    nat = _clamp(10 - cv * 18)
    if len({v.strip() for v in q.choices.values()}) < 4:
        nat = min(nat, 3.0); c.issues.append("選択肢の自然さ: 重複選択肢")
    if any(len(v.strip()) < 4 for v in q.choices.values()):
        nat = min(nat, 4.0)
    c.dims["choice_naturalness"] = nat

    # 5. 解説の教育的価値
    ev = 4.0
    if len(q.explanation) >= 60:
        ev += 3.0
    elif len(q.explanation) >= 40:
        ev += 1.5
    else:
        c.issues.append("解説の教育的価値: 解説が薄い")
    if all(len(q.choice_explanations.get(k, "").strip()) >= 6 for k in "ABCD"):
        ev += 2.0
    if q.practical_point.strip():
        ev += 1.0
    c.dims["explanation_value"] = _clamp(ev)

    # 6. 出典追跡性（claim/source/タイムスタンプ）
    tr = 0.0
    if q.claim_ids: tr += 4.0
    if q.source_ids: tr += 3.0
    ts = any((claims_by_id.get(cid, {}).get("timestamp") or "") for cid in q.claim_ids)
    if ts: tr += 3.0
    else: c.issues.append("出典追跡性: 紐付claimにタイムスタンプが無い")
    c.dims["traceability"] = _clamp(tr)

    # 7. 男性向け教育として適切（煽情トーンが無い）
    fit = 10.0
    for t in AROUSAL_TERMS:
        if t in (authoritative + " " + " ".join(q.choices.values())):
            fit -= 4; c.issues.append(f"適切さ: 煽情的トーン「{t}」")
    c.dims["male_education_fit"] = _clamp(fit)

    # 8. 女性を一括りにしていない
    ng = 10.0
    for t in ABSOLUTE_TERMS:
        if t in authoritative:
            ng -= 5; c.issues.append(f"一括り: 教材主張に断定「{t}」")
    if q.chapter in VARIATION_CHAPTERS and not q.individual_variation_note.strip():
        ng -= 3; c.issues.append("一括り: 個人差の注記が無い")
    c.dims["no_generalization"] = _clamp(ng)

    # 9. 性的テクニック偏重でない
    nt = 10.0
    for t in TECHNIQUE_TERMS:
        if t in (authoritative + " " + " ".join(q.choices.values())):
            nt -= 4; c.issues.append(f"テクニック偏重: 「{t}」")
    c.dims["not_technique_biased"] = _clamp(nt)

    # 10. 相互理解・同意・コミュニケーション
    cc = 4.0
    if q.consent_note.strip():
        cc += 3.0
    elif q.chapter in CONSENT_CHAPTERS:
        cc -= 1.0; c.issues.append("同意配慮: 該当章で同意の注記が無い")
    if any(h in (q.practical_point + q.individual_variation_note + q.consent_note) for h in DIALOGUE_HINTS):
        cc += 3.0
    c.dims["consent_communication"] = _clamp(cc)

    c.total = round(sum(c.dims.values()), 1)

    # 判定
    serious = (
        (not q.claim_ids) or q.evidence_level == "D" or
        (q.correct_answer not in q.choices) or (not qa.publishable)
    )
    if serious:
        c.verdict = "reject"
    elif c.total < PASS_TOTAL:
        c.verdict = "fix"
    else:
        c.verdict = "ok"
    return c
