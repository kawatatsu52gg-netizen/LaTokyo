"""
取り込み層 (Source Manager の一部)。

inbox/notebooklm_exports/ 内のファイルを読み、
  - メタデータ（YouTube URL / タイトル / チャンネル / 公開日 / タイムスタンプ）
  - 本文（要約・引用・ノート）
を抽出して「生テキスト + メタデータ」の中間表現にする。

対応形式:
  - .md / .txt : 推奨YAML風フロントマター + 本文（下記テンプレート参照）
  - .csv       : NotebookLM/Sheetsからの表形式（列: statement, quote, timestamp ...）
  - .pdf       : pypdf があれば抽出、無ければスキップ（警告）

外部依存ゼロで動く。PDF は任意依存 (pypdf) が入っていれば対応。

推奨フロントマターテンプレート（人が NotebookLM 書き出しの先頭に付ける）:
---
title: 動画タイトル
youtube_url: https://www.youtube.com/watch?v=XXXX
channel_name: チャンネル名
published_at: 2025-01-01
notebook_name: 女性解剖ノート
---
（以下、NotebookLMの要約・引用本文）
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


SUPPORTED = {".md", ".txt", ".csv", ".pdf"}


@dataclass
class IngestResult:
    filename: str
    meta: dict[str, str] = field(default_factory=dict)
    body: str = ""
    rows: list[dict[str, str]] = field(default_factory=list)  # csv用
    content_hash: str = ""
    warnings: list[str] = field(default_factory=list)


def _hash(text: str) -> str:
    # 空白正規化してから内容ハッシュ（表記ゆれで別扱いにしない）
    norm = re.sub(r"\s+", " ", text).strip().lower()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """先頭の --- ... --- ブロックを key: value として読む。無ければ空。"""
    meta: dict[str, str] = {}
    m = re.match(r"^\s*---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.DOTALL)
    if not m:
        return meta, text
    block, body = m.group(1), m.group(2)
    for line in block.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, body


def _read_pdf(path: Path) -> tuple[str, list[str]]:
    warnings: list[str] = []
    try:
        import pypdf  # type: ignore
    except Exception:
        warnings.append(
            f"{path.name}: PDF抽出には pypdf が必要です（pip install pypdf）。"
            "この回はスキップしました。"
        )
        return "", warnings
    try:
        reader = pypdf.PdfReader(str(path))
        return "\n".join((p.extract_text() or "") for p in reader.pages), warnings
    except Exception as e:  # pragma: no cover
        warnings.append(f"{path.name}: PDF読み込み失敗 ({e})")
        return "", warnings


def ingest_file(path: str | Path) -> IngestResult:
    path = Path(path)
    ext = path.suffix.lower()
    res = IngestResult(filename=path.name)
    if ext not in SUPPORTED:
        res.warnings.append(f"{path.name}: 未対応の拡張子 {ext} をスキップ")
        return res

    if ext == ".csv":
        raw = path.read_text(encoding="utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(raw))
        res.rows = [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in reader]
        res.body = raw
        res.content_hash = _hash(raw)
        # CSV先頭にメタ列があれば拾う
        if res.rows:
            for key in ("title", "youtube_url", "channel_name", "published_at", "notebook_name"):
                if key in res.rows[0]:
                    res.meta[key] = res.rows[0][key]
        return res

    if ext == ".pdf":
        text, warns = _read_pdf(path)
        res.warnings.extend(warns)
        res.body = text
        res.content_hash = _hash(text) if text else _hash(path.name)
        return res

    # .md / .txt
    raw = path.read_text(encoding="utf-8", errors="replace")
    meta, body = _parse_frontmatter(raw)
    res.meta = meta
    res.body = body
    res.content_hash = _hash(body)
    if not meta.get("youtube_url"):
        res.warnings.append(
            f"{path.name}: youtube_url が未記載。出典追跡のためフロントマターの記入を推奨します。"
        )
    return res


def iter_inbox(inbox_dir: str | Path) -> list[Path]:
    inbox = Path(inbox_dir)
    if not inbox.exists():
        return []
    return sorted(p for p in inbox.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED)
