"""
主張抽出層 (Source Manager + 専門エージェントの下ごしらえ)。

正規化された候補文を Claim に構造化する。
このモジュールは決定論的なヒューリスティックで
  - topic / anatomical_region / nerve / receptor / stimulus_type のタグ付け
  - 出典追跡可能性（source_quote の有無）の判定
を行い、初期状態は必ず verification_status="needs_review", evidence_level="D"
とする。

重要な設計方針:
  「NotebookLM がそう言った」だけでは verified にしない。
  医学的妥当性の確定は Medical Evidence Reviewer（人間 + Claude）が行い、
  そのレビュー後に verified / rejected へ更新する。
"""
from __future__ import annotations

import re

from ..schemas import Claim
from ..normalization.normalize import CandidateSentence


# キーワード分類辞書（正式用語へ寄せる）
TOPIC_KEYWORDS: dict[str, list[str]] = {
    "外性器・内性器": ["外陰", "vulva", "大陰唇", "小陰唇", "前庭", "膣", "腟", "子宮", "卵巣", "尿道"],
    "陰核": ["陰核", "クリトリス", "clitoris", "陰核脚", "前庭球", "亀頭"],
    "神経支配": ["神経", "陰部神経", "陰核背神経", "骨盤内臓神経", "下腹神経", "仙骨", "脊髄", "分節", "迷走神経"],
    "感覚受容": ["受容器", "meissner", "マイスネル", "パチニ", "pacinian", "merkel", "メルケル", "ruffini", "ルフィニ", "自由神経終末", "受容"],
    "骨盤底": ["骨盤底", "肛門挙筋", "恥骨尾骨", "恥骨直腸", "横隔膜", "呼吸", "姿勢"],
    "性的興奮・血流": ["興奮", "血流", "充血", "副交感", "交感", "潤滑", "ドーパミン", "オキシトシン"],
    "オーガズム": ["オーガズム", "orgasm", "絶頂", "収縮", "反射"],
    "痛み・過緊張": ["痛み", "性交痛", "dyspareunia", "過緊張", "vaginismus", "膣痙"],
    "個人差・コミュニケーション": ["個人差", "コミュニケーション", "同意", "対話", "尊重", "consent"],
    "俗説の訂正": ["俗説", "誤解", "神話", "myth", "gスポット", "g-spot", "潮吹き", "処女膜"],
}

REGION_KEYWORDS: dict[str, list[str]] = {
    "外陰部": ["外陰", "vulva", "恥丘"],
    "陰核": ["陰核", "クリトリス", "clitoris"],
    "大陰唇": ["大陰唇"],
    "小陰唇": ["小陰唇"],
    "腟前庭": ["前庭", "vestibule"],
    "膣": ["膣", "腟"],
    "子宮": ["子宮"],
    "卵巣": ["卵巣"],
    "尿道": ["尿道"],
    "骨盤底筋": ["骨盤底", "肛門挙筋", "恥骨尾骨", "恥骨直腸"],
}

NERVE_KEYWORDS: dict[str, list[str]] = {
    "陰部神経": ["陰部神経", "pudendal"],
    "陰核背神経": ["陰核背神経", "dorsal nerve of clitoris"],
    "骨盤内臓神経": ["骨盤内臓神経", "pelvic splanchnic"],
    "下腹神経": ["下腹神経", "hypogastric"],
    "迷走神経": ["迷走神経", "vagus"],
    "仙骨神経叢": ["仙骨神経叢", "sacral plexus", "s2", "s3", "s4"],
}

RECEPTOR_KEYWORDS: dict[str, list[str]] = {
    "Meissner小体": ["meissner", "マイスネル", "マイスナー"],
    "Pacinian小体": ["pacinian", "パチニ"],
    "Merkel細胞": ["merkel", "メルケル"],
    "Ruffini終末": ["ruffini", "ルフィニ"],
    "自由神経終末": ["自由神経終末", "free nerve ending", "侵害受容"],
}

STIMULUS_KEYWORDS: dict[str, list[str]] = {
    "light_touch": ["軽い接触", "軽いタッチ", "触覚", "撫で"],
    "sustained_pressure": ["持続圧", "圧迫", "押す", "圧"],
    "vibration": ["振動"],
    "skin_stretch": ["皮膚伸張", "伸展", "ストレッチ"],
    "temperature": ["温度", "温", "冷"],
    "nociception": ["侵害", "痛"],
    "myofascial": ["筋膜", "筋への", "機械刺激"],
}


def _match(text: str, table: dict[str, list[str]]) -> str:
    """最長一致を優先（例: 「陰核背神経」を「陰部神経」より優先）。"""
    low = text.lower()
    best_label = ""
    best_len = 0
    for label, kws in table.items():
        for kw in kws:
            if kw.lower() in low and len(kw) > best_len:
                best_label = label
                best_len = len(kw)
    return best_label


def classify(text: str) -> dict[str, str]:
    return {
        "topic": _match(text, TOPIC_KEYWORDS),
        "anatomical_region": _match(text, REGION_KEYWORDS),
        "nerve": _match(text, NERVE_KEYWORDS),
        "receptor": _match(text, RECEPTOR_KEYWORDS),
        "stimulus_type": _match(text, STIMULUS_KEYWORDS) or "none",
    }


# 断定的すぎる表現（要検証を強めるシグナル）
ABSOLUTE_PATTERNS = [
    r"必ず", r"全員", r"誰でも", r"絶対", r"100%", r"すべての女性",
]


def looks_overgeneralized(text: str) -> bool:
    return any(re.search(p, text) for p in ABSOLUTE_PATTERNS)


def build_claims(
    candidates: list[CandidateSentence],
    start_index: int = 1,
) -> list[Claim]:
    """候補文を Claim 化。全件 needs_review / evidence D で初期化する。"""
    claims: list[Claim] = []
    idx = start_index
    seen: set[str] = set()
    for c in candidates:
        key = re.sub(r"\s+", "", c.text)[:60]
        if key in seen:
            continue  # 同一source内の重複文を除去
        seen.add(key)
        tags = classify(c.text)
        notes = []
        if not c.is_quote and not c.timestamp:
            notes.append("出典位置（引用/タイムスタンプ）が不明。原文照合が必要。")
        if looks_overgeneralized(c.text):
            notes.append("断定的表現あり。個人差の観点で要修正の可能性。")
        claim = Claim(
            claim_id=f"CLM-{idx:04d}",
            statement=c.text,
            topic=tags["topic"],
            anatomical_region=tags["anatomical_region"],
            nerve=tags["nerve"],
            receptor=tags["receptor"],
            stimulus_type=tags["stimulus_type"],
            timestamp=c.timestamp,
            source_quote=c.text if c.is_quote else "",
            evidence_level="D",
            verification_status="needs_review",
            review_notes=" / ".join(notes),
        )
        claims.append(claim)
        idx += 1
    return claims
