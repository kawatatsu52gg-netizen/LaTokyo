"""
Empathy（感情・相手理解）モジュール生成。

KB(=SSoT)の身体知識に、感情ライブラリを重ねて7ステップを生成する:
  1. 身体の知識（KBから・自動平易化）
  2. なぜそれが大切なのか
  3. パートナーはどんな気持ちになるか
  4. コミュニケーション例
  5. よくある失敗
  6. より良い会話例
  7. 学び

目的は知識の暗記ではなく「相手を理解できる人になること」。
感情パートは尊重・同意・対話を軸にした共感ライブラリ(data/empathy/empathy.json)から取り、
テクニック指南にはしない。
"""
from __future__ import annotations

import json
from pathlib import Path

from .plain import to_plain

ROOT = Path(__file__).resolve().parent.parent.parent
EMPATHY = ROOT / "data" / "empathy" / "empathy.json"
KB_DB = ROOT / "data" / "database" / "kb.db"


def _load() -> dict:
    try:
        return json.loads(EMPATHY.read_text(encoding="utf-8"))
    except Exception:
        return {"categories": {}, "topic_category": {}, "subjects": {}}


# 主題名のキーワードでカテゴリを補正
KEYWORD_CATEGORY = [
    ("痛", "pain"), ("性交痛", "pain"),
    ("オーガズム", "orgasm"), ("絶頂", "orgasm"),
    ("個人差", "individual"), ("コミュニケーション", "individual"), ("同意", "individual"),
    ("興奮", "arousal"), ("血流", "arousal"), ("潤", "arousal"),
    ("受容", "sensation"), ("神経", "sensation"), ("感覚", "sensation"),
]


def _resolve_category(subject: str, topic_id: str | None, lib: dict) -> str:
    subj = lib.get("subjects", {}).get(subject)
    if subj and subj.get("category"):
        return subj["category"]
    for kw, cat in KEYWORD_CATEGORY:
        if kw in subject:
            return cat
    if topic_id and topic_id in lib.get("topic_category", {}):
        return lib["topic_category"][topic_id]
    return "location"


def build_module(subject: str) -> dict:
    lib = _load()
    from ..kb.store import KB
    from ..kb.bundle import build_bundle

    kb = KB(KB_DB)
    try:
        b = build_bundle(kb, subject, min_evidence="B")
        display = b.display_name
        topic_id = b.subject_id if b.subject_kind == "topic" else \
            (kb.get_entity(b.subject_id) or {}).get("topic_id")
        facts = [to_plain(f.text) for f in b.facts[:5]]
        sources = [s.get("source_id") for s in b.sources]
    except ValueError:
        display, topic_id, facts, sources = subject, None, [], []
    finally:
        kb.close()

    cat = _resolve_category(subject, topic_id, lib)
    base = dict(lib.get("categories", {}).get(cat, {}))
    # 主題固有の上書き
    override = lib.get("subjects", {}).get(subject, {})
    for k, v in override.items():
        if k != "category":
            base[k] = v

    return {
        "subject": display,
        "category": cat,
        "body_knowledge": facts,
        "why_it_matters": base.get("why_it_matters", ""),
        "partner_feelings": base.get("partner_feelings", []),
        "comm_example": base.get("comm_example", ""),
        "common_mistakes": base.get("common_mistakes", []),
        "better_conversation": base.get("better_conversation", ""),
        "lesson": base.get("lesson", ""),
        "sources": sources,
    }


def _bullets(items: list[str]) -> list[str]:
    return [f"- {x}" for x in items] if items else ["- —"]


def render_markdown(m: dict) -> str:
    body = _bullets(m["body_knowledge"]) if m["body_knowledge"] else \
        ["- （この主題の検証済み知識がまだ少ないため、まずは基本から）"]
    L: list[str] = []
    L.append("<!-- generated_from: Knowledge Base（身体知識）＋ Empathyライブラリ（感情・対話） -->")
    L.append(f"# {m['subject']} から学ぶ『相手を理解する』")
    L.append("")
    L.append("> 目的は知識を覚えることではなく、相手を理解できる人になることです。")
    L.append("")
    L.append("## 1. 身体の知識（やさしく）"); L += body
    L += ["", "## 2. なぜそれが大切なのか", m["why_it_matters"] or "—"]
    L += ["", "## 3. パートナーはどんな気持ちになるか"] + _bullets(m["partner_feelings"])
    L += ["", "## 4. コミュニケーション例", f"> {m['comm_example'] or '—'}"]
    L += ["", "## 5. よくある失敗"] + _bullets(m["common_mistakes"])
    L += ["", "## 6. より良い会話例", f"> {m['better_conversation'] or '—'}"]
    L += ["", "## 7. 学び", m["lesson"] or "—"]
    L += ["", "---",
          f"出典（身体知識・KBより）: {', '.join(m['sources']) or 'Knowledge Base'}",
          "※ 感情・会話パートは、尊重・同意・対話を大切にするための例です。決まった正解ではなく、"
          "目の前の相手に聞くことを一番大切にしてください。"]
    return "\n".join(L)
