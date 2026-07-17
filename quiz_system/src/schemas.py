"""
データスキーマ定義と検証（stdlibのみ）。

このモジュールは system 全体で共有される 3 つの主要スキーマを定義する:
  - Source   : 情報源（YouTube動画 / NotebookLM書き出し）
  - Claim    : 医学的主張（出典・エビデンスレベル付き）
  - Quiz     : 4択クイズ

外部依存を持たず、辞書 <-> データクラスの相互変換と、
最低限のバリデーション（必須項目・列挙値・参照整合性）を提供する。
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


# --- 列挙値 -------------------------------------------------------------

EVIDENCE_LEVELS = {"A", "B", "C", "D"}
# A: 解剖学的に確立した知識
# B: 複数の研究で比較的一貫している
# C: 限定的な研究または議論がある
# D: 仮説・俗説・根拠不十分

VERIFICATION_STATUS = {"verified", "needs_review", "rejected"}
REVIEW_STATUS = {"draft", "reviewed", "approved", "rejected"}

STIMULUS_TYPES = {
    "light_touch",       # 軽い接触
    "sustained_pressure",  # 持続圧
    "vibration",         # 振動
    "skin_stretch",      # 皮膚伸張
    "temperature",       # 温度
    "nociception",       # 侵害刺激
    "myofascial",        # 筋・筋膜への機械刺激
    "none",
}

# 章構成（第1〜10章）
CHAPTERS = {
    1: "女性の外性器と内性器",
    2: "陰核の立体構造",
    3: "女性器の神経支配",
    4: "皮膚・粘膜の感覚受容",
    5: "骨盤底筋と呼吸",
    6: "性的興奮と血流",
    7: "オーガズムの神経生理",
    8: "痛み、性交痛、過緊張",
    9: "個人差とコミュニケーション",
    10: "よくある俗説と医学的事実",
}

LEVELS = {1, 2, 3}


class ValidationError(Exception):
    """スキーマ検証エラー。message に人間可読の理由を持つ。"""


# --- Claim --------------------------------------------------------------

@dataclass
class Claim:
    claim_id: str
    statement: str
    topic: str = ""
    anatomical_region: str = ""
    nerve: str = ""
    receptor: str = ""
    stimulus_type: str = "none"
    timestamp: str = ""
    source_quote: str = ""
    evidence_level: str = "D"
    verification_status: str = "needs_review"
    review_notes: str = ""

    def validate(self) -> list[str]:
        errs: list[str] = []
        if not self.claim_id:
            errs.append("claim_id が空です")
        if not self.statement.strip():
            errs.append(f"{self.claim_id}: statement が空です")
        if self.evidence_level not in EVIDENCE_LEVELS:
            errs.append(f"{self.claim_id}: evidence_level 不正 ({self.evidence_level})")
        if self.verification_status not in VERIFICATION_STATUS:
            errs.append(f"{self.claim_id}: verification_status 不正 ({self.verification_status})")
        if self.stimulus_type not in STIMULUS_TYPES:
            errs.append(f"{self.claim_id}: stimulus_type 不正 ({self.stimulus_type})")
        # 出典追跡: verified なら source_quote が必要
        if self.verification_status == "verified" and not self.source_quote.strip():
            errs.append(f"{self.claim_id}: verified には source_quote（原文引用）が必要です")
        return errs

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Claim":
        known = {f for f in Claim.__dataclass_fields__}  # type: ignore[attr-defined]
        return Claim(**{k: v for k, v in d.items() if k in known})


# --- Source -------------------------------------------------------------

@dataclass
class Source:
    source_id: str
    source_type: str = "youtube"
    title: str = ""
    youtube_url: str = ""
    channel_name: str = ""
    published_at: str = ""
    imported_at: str = ""
    notebook_name: str = ""
    notebook_export_file: str = ""
    content_hash: str = ""       # 重複検出用
    claims: list[Claim] = field(default_factory=list)

    def validate(self) -> list[str]:
        errs: list[str] = []
        if not self.source_id:
            errs.append("source_id が空です")
        if not self.title.strip():
            errs.append(f"{self.source_id}: title が空です")
        if not self.notebook_export_file:
            errs.append(f"{self.source_id}: notebook_export_file（取り込み元）が未記録です")
        for c in self.claims:
            errs.extend(c.validate())
        return errs

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Source":
        claims = [Claim.from_dict(c) for c in d.get("claims", [])]
        known = {f for f in Source.__dataclass_fields__}  # type: ignore[attr-defined]
        base = {k: v for k, v in d.items() if k in known and k != "claims"}
        return Source(claims=claims, **base)


# --- Quiz ---------------------------------------------------------------

@dataclass
class Quiz:
    quiz_id: str
    chapter: int
    level: int
    question: str
    choices: dict[str, str]
    correct_answer: str
    explanation: str
    choice_explanations: dict[str, str]
    practical_point: str = ""
    individual_variation_note: str = ""
    consent_note: str = ""
    source_ids: list[str] = field(default_factory=list)
    claim_ids: list[str] = field(default_factory=list)
    evidence_level: str = "D"
    needs_verification: str = ""   # 要検証事項（自由記述）
    review_status: str = "draft"

    def validate(self) -> list[str]:
        errs: list[str] = []
        if not self.quiz_id:
            errs.append("quiz_id が空です")
        if self.chapter not in CHAPTERS:
            errs.append(f"{self.quiz_id}: chapter 不正 ({self.chapter})")
        if self.level not in LEVELS:
            errs.append(f"{self.quiz_id}: level 不正 ({self.level})")
        if set(self.choices.keys()) != {"A", "B", "C", "D"}:
            errs.append(f"{self.quiz_id}: choices は A,B,C,D の4つが必要です")
        if self.correct_answer not in {"A", "B", "C", "D"}:
            errs.append(f"{self.quiz_id}: correct_answer 不正 ({self.correct_answer})")
        if set(self.choice_explanations.keys()) != {"A", "B", "C", "D"}:
            errs.append(f"{self.quiz_id}: choice_explanations は A,B,C,D の4つが必要です")
        if self.evidence_level not in EVIDENCE_LEVELS:
            errs.append(f"{self.quiz_id}: evidence_level 不正 ({self.evidence_level})")
        if self.review_status not in REVIEW_STATUS:
            errs.append(f"{self.quiz_id}: review_status 不正 ({self.review_status})")
        # 出典追跡: 承認候補には claim_ids / source_ids が必須
        if not self.claim_ids:
            errs.append(f"{self.quiz_id}: claim_ids が空（出典不明の主張から問題を作らない）")
        if not self.source_ids:
            errs.append(f"{self.quiz_id}: source_ids が空")
        return errs

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Quiz":
        known = {f for f in Quiz.__dataclass_fields__}  # type: ignore[attr-defined]
        return Quiz(**{k: v for k, v in d.items() if k in known})
