"""
Learning Designer — KB追加後に、あるテーマの学習コンテンツ一式を生成する。
Quiz / Instagram / Slide / YouTube台本 / Patient Guide を KB からのみ生成（SSoT）。
内部で既存の Content Generator を呼ぶ。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
KB_DB = ROOT / "data" / "database" / "kb.db"

DESIGN_FORMATS = ["quiz", "instagram", "slide", "youtube", "patient"]


def design(subject: str, log=print) -> dict:
    """subject（テーマ名/エンティティ名）について学習コンテンツを生成。"""
    from ..content.generator import generate_content
    made = []
    for fmt in DESIGN_FORMATS:
        p = generate_content(KB_DB, fmt, subject, log=log)
        if p:
            made.append({"format": fmt, "path": str(p)})
    return {"subject": subject, "generated": made, "count": len(made)}
