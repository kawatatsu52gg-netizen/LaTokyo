"""
品質検証層 (Quality Assurance エージェント + Consent/Communication Reviewer)。

完成したクイズに対して決定論的な QA ルールを適用し、
合否と指摘リストを返す。重大な欠陥がある問題は publishable=False。

チェック項目（要件対応）:
  1. 正解が一つに限定されるか（correct_answer が choices に存在、A-D）
  2. 出典が存在するか（claim_ids / source_ids）
  3. 解説と正解が矛盾していないか（explanationに正解肢の趣旨が含まれるか簡易判定）
  4. 不正解選択肢の説明が存在するか（choice_explanations 4件）
  5. 医学的断定が強すぎないか（禁止語）
  6. 性的に煽る表現がないか（禁止語 + ヒューリスティック）
  7. 性別固定観念がないか（「女性は必ず〜」等）
  8. 成人向け教育として適切か（同意・個人差の配慮）
  9. 同意と個人差が尊重されているか（該当章で consent_note / individual_variation_note）
 10. 選択肢の文章量から正解が推測できないか（長さの偏り）
 11. 「すべて正しい」「どれでもない」を原則使用しない
 12. 同一内容の重複問題がないか（別関数 detect_duplicates）
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..schemas import Quiz, EVIDENCE_LEVELS


@dataclass
class QAResult:
    quiz_id: str
    passed: bool = True
    publishable: bool = True
    errors: list[str] = field(default_factory=list)     # 重大（公開不可）
    warnings: list[str] = field(default_factory=list)   # 軽微（要確認）

    def add_error(self, msg: str) -> None:
        self.errors.append(msg)
        self.passed = False
        self.publishable = False

    def add_warning(self, msg: str) -> None:
        self.warnings.append(msg)
        self.passed = False


DEFAULT_BANNED_ABSOLUTE = ["必ず感じる", "全員が", "誰でも必ず", "絶対に", "100%の女性", "すべての女性が"]
DEFAULT_BANNED_STEREOTYPE = ["女性はこうすれば", "女性は皆", "女はみんな"]
DEFAULT_ALL_NONE = ["すべて正しい", "すべて誤り", "上記すべて", "どれでもない", "以上すべて", "全て正しい"]

# 章 -> consent/individual 配慮を必須にするか
CONSENT_REQUIRED_CHAPTERS = {6, 7, 8, 9}
VARIATION_REQUIRED_CHAPTERS = {6, 7, 8, 9, 4, 3}


def qa_quiz(q: Quiz, config: dict | None = None) -> QAResult:
    cfg = config or {}
    banned_abs = cfg.get("banned_absolute_terms", DEFAULT_BANNED_ABSOLUTE)
    max_ratio = cfg.get("max_choice_length_ratio", 1.8)
    consent_chapters = set(cfg.get("require_consent_note_chapters", CONSENT_REQUIRED_CHAPTERS))

    r = QAResult(quiz_id=q.quiz_id)

    # スキーマ整合（重大）
    for e in q.validate():
        r.add_error(f"スキーマ: {e}")

    # 1. 正解の一意性
    if q.correct_answer not in q.choices:
        r.add_error("正解が選択肢に存在しない")

    # 2. 出典
    if not q.claim_ids:
        r.add_error("出典(claim_ids)が無い問題は公開不可")

    # 3. 解説と正解の整合（簡易）: explanation が空でない、正解肢の文言と関連
    if not q.explanation.strip():
        r.add_error("解説(explanation)が空")
    else:
        correct_text = q.choices.get(q.correct_answer, "")
        # 正解肢のキーワードが解説に一部でも現れるか（緩い整合チェック）
        kw = _keywords(correct_text)
        if kw and not any(k in q.explanation for k in kw):
            r.add_warning("解説に正解肢の主旨が見当たらない（矛盾の可能性）。要確認。")

    # 4. 不正解説明
    for k in ("A", "B", "C", "D"):
        if not q.choice_explanations.get(k, "").strip():
            r.add_error(f"選択肢{k}の説明(choice_explanations)が空")

    # 5/7. 断定・固定観念
    # 断定・固定観念の禁止は「教材として主張している文」に適用する。
    # 不正解の選択肢(distractor)は、誤った断定をあえて提示して否定する狙いがあるため、
    # 正解肢・設問・解説・各選択肢の解説のみを対象にする（distractor本文は除外）。
    authoritative = " ".join([
        q.question, q.explanation, q.choices.get(q.correct_answer, ""),
        *q.choice_explanations.values(),
    ])
    for term in banned_abs + DEFAULT_BANNED_STEREOTYPE:
        if term in authoritative:
            r.add_error(f"過度な断定/固定観念表現: 「{term}」")
    # distractorに断定語がある場合は、解説で明確に否定しているか警告で促す
    for k, v in q.choices.items():
        if k == q.correct_answer:
            continue
        for term in banned_abs + DEFAULT_BANNED_STEREOTYPE:
            if term in v and term not in q.choice_explanations.get(k, ""):
                r.add_warning(f"選択肢{k}の断定「{term}」は誤り選択肢。解説で否定されているか確認")

    # 6. 煽る表現（教育目的から逸脱するトーン）
    full = authoritative + " " + " ".join(q.choices.values())
    for term in _AROUSAL_HEURISTICS:
        if term in full:
            r.add_warning(f"表現トーン要確認: 「{term}」")

    # 9. 同意・個人差の配慮（該当章）
    if q.chapter in consent_chapters and not q.consent_note.strip():
        r.add_warning(f"第{q.chapter}章は consent_note（同意・安全配慮）の記載を推奨")
    if q.chapter in VARIATION_REQUIRED_CHAPTERS and not q.individual_variation_note.strip():
        r.add_warning(f"第{q.chapter}章は individual_variation_note（個人差）の記載を推奨")

    # 10. 選択肢長の偏り（正解だけ極端に長い/短いと推測可能）
    lengths = {k: len(v) for k, v in q.choices.items()}
    if lengths:
        cl = lengths[q.correct_answer]
        others = [v for k, v in lengths.items() if k != q.correct_answer]
        avg_other = sum(others) / len(others) if others else cl
        if avg_other > 0 and (cl / avg_other > max_ratio or avg_other / max(cl, 1) > max_ratio):
            r.add_warning("正解肢の文章量が他と偏っており、長さから推測可能な恐れ")

    # 11. すべて正しい/どれでもない
    for k, v in q.choices.items():
        for banned in DEFAULT_ALL_NONE:
            if banned in v:
                r.add_error(f"選択肢{k}に禁止パターン「{banned}」")

    # エビデンス
    if q.evidence_level not in EVIDENCE_LEVELS:
        r.add_error(f"evidence_level 不正 ({q.evidence_level})")
    if q.evidence_level == "D":
        r.add_error("エビデンスレベルD（俗説・根拠不十分）の主張は公開不可")

    return r


_AROUSAL_HEURISTICS = ["エロ", "気持ちよくさせる方法", "感じさせるテクニック", "攻める"]


def _keywords(text: str) -> list[str]:
    # 日本語の名詞的断片を粗く抽出（2文字以上の連続漢字/カタカナ）
    return re.findall(r"[一-龥ァ-ヶー]{2,}", text)[:6]


def detect_duplicates(quizzes: list[Quiz]) -> list[tuple[str, str]]:
    """設問テキストの近似重複を検出（正規化して集合類似）。"""
    dups: list[tuple[str, str]] = []
    norm = {q.quiz_id: set(_keywords(q.question + " " + q.choices.get(q.correct_answer, ""))) for q in quizzes}
    ids = list(norm.keys())
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = norm[ids[i]], norm[ids[j]]
            if not a or not b:
                continue
            inter = len(a & b)
            union = len(a | b)
            if union and inter / union >= 0.7:
                dups.append((ids[i], ids[j]))
    return dups
