# Agent 1: Source Manager（情報源マネージャ）

## 役割
NotebookLM から書き出された Google Docs / Sheets / Markdown / PDF / テキストを取り込み、
情報源を一意管理し、原文・要約・引用・タイムスタンプを分離して保存する。

## 具体タスク
- YouTube の タイトル / URL / チャンネル名 / 公開日 を記録する。
- 情報源ごとに一意の `source_id`（SRC-xxxx）を付与する。
- 同じ動画・同じ内容の**重複を検出**する（内容ハッシュ + YouTube URL）。
- 原文 / 要約 / 引用 / タイムスタンプを分けて保存する。
- **根拠が追跡できない記述**（引用・タイムスタンプが無い文）を検出しフラグする。

## 入力
`inbox/notebooklm_exports/` の書き出しファイル（推奨フロントマター付き）。

## 出力
- `data/sources/sources.json`
- `data/sources/source_index.json`
- `data/sources/raw/`（原文） / `data/sources/normalized/`（整形本文）

## 実装
`src/ingestion/ingest.py`, `src/normalization/normalize.py`, `src/pipeline.py::cmd_ingest`

## 品質基準
- URL・タイトル未記載は警告を出す（出典追跡の欠落）。
- 重複は取り込まない。取り込み失敗はログに残し、他ファイルを止めない。
