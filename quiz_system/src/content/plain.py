"""
平易化エンジン。KBの専門的な文を、解剖学を知らない一般の人にも分かる
「小学生でも理解できる」表現へ自動変換する。

KB本体は専門レベルのまま保持し、この層だけが初心者向けに言い換える。
辞書 data/beginner/glossary.json を用い、長い語から順に置換する。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
GLOSSARY = ROOT / "data" / "beginner" / "glossary.json"

# 硬い言い回し→やさしい言い回し
SOFTEN = {
    "に由来する": "から来ている",
    "に分類される": "の仲間である",
    "関与する": "関係している",
    "支配する": "コントロールしている",
    "を担う": "の役目をする",
    "に富む": "がたくさんある",
    "高密度に分布する": "たくさん集まっている",
    "一因になりうる": "原因のひとつになることがある",
    "とされる": "と言われている",
    "が示されている": "とわかっている",
    "および": "と",
    "ならびに": "と",
    "など": "など",
    "する際": "するとき",
    "における": "での",
    "優位で": "が中心で",
    "優位": "が中心",
}


def load_glossary() -> dict[str, str]:
    try:
        return json.loads(GLOSSARY.read_text(encoding="utf-8")).get("terms", {})
    except Exception:
        return {}


_CACHE: dict[str, str] | None = None


def _terms() -> list[tuple[str, str]]:
    global _CACHE
    if _CACHE is None:
        _CACHE = load_glossary()
    # 長い語を先に置換（部分一致の取りこぼし防止）
    return sorted(_CACHE.items(), key=lambda kv: len(kv[0]), reverse=True)


def to_plain(text: str) -> str:
    """専門語・硬い言い回しをやさしい表現に置換する。"""
    if not text:
        return text
    out = text
    for term, plain in _terms():
        out = out.replace(term, plain)
    for hard, soft in SOFTEN.items():
        out = out.replace(hard, soft)
    # 全角括弧の英字注記など、初心者に不要な補足を軽く削る
    out = re.sub(r"（[A-Za-z0-9 ,\.\-']+）", "", out)
    out = re.sub(r"\([A-Za-z0-9 ,\.\-']+\)", "", out)
    # 置換で生じた「語(語)」「語（語）」の重複を畳む（後方参照で同一語に限定）
    out = re.sub(r"([^()（）\s]{2,14})\(\1\)", r"\1", out)
    out = re.sub(r"([^()（）\s]{2,14})（\1）", r"\1", out)
    out = re.sub(r"\s{2,}", " ", out).strip()
    return out


def jargon_in(text: str) -> list[str]:
    """まだ残っている専門語（辞書に載っている語）を検出する。品質チェック用。"""
    found = []
    for term, _ in _terms():
        if term in (text or ""):
            found.append(term)
    return found
