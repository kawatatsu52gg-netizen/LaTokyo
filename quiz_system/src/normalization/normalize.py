"""
正規化層。

取り込み結果(IngestResult)を、
  - normalized テキスト（章・箇条書きを保った素直な本文）
  - 候補文リスト（claim抽出の入力）
に整える。

「原文・要約・引用・タイムスタンプを分けて保存」という Source Manager の
要件のため、行内の [mm:ss] / (mm:ss) 形式のタイムスタンプを検出して
各候補文に紐づける。
"""
from __future__ import annotations

import re
from dataclasses import dataclass


TIMESTAMP_RE = re.compile(r"[\[\(（]?(\d{1,2}:\d{2}(?::\d{2})?)[\]\)）]?")
# 引用マーカー: 「」 “” " " や NotebookLM の脚注 [1] など
QUOTE_RE = re.compile(r"[「“\"]([^」”\"]{6,})[」”\"]")


@dataclass
class CandidateSentence:
    text: str
    timestamp: str = ""
    is_quote: bool = False


def _split_sentences(body: str) -> list[str]:
    # 箇条書き・改行・日本語句点で分割
    parts: list[str] = []
    for block in body.splitlines():
        block = block.strip()
        if not block:
            continue
        # 箇条書き記号を除去
        block = re.sub(r"^[\-\*・•]\s*", "", block)
        # 見出しはそのまま1文扱い
        block = re.sub(r"^#+\s*", "", block)
        # 日本語の文末で分割（。！？）
        for s in re.split(r"(?<=[。！？])\s*", block):
            s = s.strip()
            if len(s) >= 8:  # 短すぎる断片は除外
                parts.append(s)
    return parts


def normalize_body(body: str) -> str:
    """余分な空白・重複改行を圧縮した閲覧用テキスト。"""
    lines = [ln.rstrip() for ln in body.splitlines()]
    out: list[str] = []
    blank = False
    for ln in lines:
        if ln.strip() == "":
            if not blank:
                out.append("")
            blank = True
        else:
            out.append(ln)
            blank = False
    return "\n".join(out).strip() + "\n"


def extract_candidates(body: str) -> list[CandidateSentence]:
    cands: list[CandidateSentence] = []
    for sent in _split_sentences(body):
        m = TIMESTAMP_RE.search(sent)
        ts = m.group(1) if m else ""
        # タイムスタンプ表記を本文から除く
        clean = TIMESTAMP_RE.sub("", sent).strip()
        is_quote = bool(QUOTE_RE.search(sent))
        if len(clean) >= 8:
            cands.append(CandidateSentence(text=clean, timestamp=ts, is_quote=is_quote))
    return cands


def candidates_from_csv_rows(rows: list[dict[str, str]]) -> list[CandidateSentence]:
    """CSV各行を候補文にする（statement/quote/timestamp列を想定）。"""
    cands: list[CandidateSentence] = []
    for row in rows:
        text = row.get("statement") or row.get("claim") or row.get("summary") or ""
        text = text.strip()
        if len(text) < 8:
            continue
        cands.append(CandidateSentence(
            text=text,
            timestamp=(row.get("timestamp") or "").strip(),
            is_quote=bool(row.get("quote")),
        ))
    return cands
