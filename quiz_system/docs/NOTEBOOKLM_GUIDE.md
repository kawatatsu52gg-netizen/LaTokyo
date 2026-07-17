# NotebookLM 運用ガイド（テンプレート）

NotebookLM は **情報整理の担当**であり、その出力は「確定した事実」ではなく
**検証前の材料**として扱う。取り込み後は全主張が `needs_review` になり、
Medical Evidence Reviewer が査読資料と照合して確定する。

使用するテンプレートは2つ（`templates/` にあり、これが正本）：
1. 入力プロンプト … [templates/notebooklm_prompt.md](../templates/notebooklm_prompt.md)
2. 書き出し雛形 … [templates/notebooklm_export_template.md](../templates/notebooklm_export_template.md)

---

## 手順
1. NotebookLM で新規ノートブックを作り、対象YouTube動画をソース登録する。
2. `notebooklm_prompt.md` の「貼り付けるプロンプト（ここから〜ここまで）」を
   そのままチャットに貼って実行する。
3. 出力を `notebooklm_export_template.md` の本文にコピーする。
4. 先頭の**必須メタ**を必ず埋める：
   - `title`（動画タイトル）
   - `youtube_url`
   - `channel_name`
   - `published_at`（YYYY-MM-DD）
   - `notebook_name`
5. ファイル名を内容が分かる名前（例 `clitoris_innervation_2025.md`）にして
   `inbox/notebooklm_exports/` に保存する。

## 整理のルール（出力の質を揃える）
- **1主張 = 1行**、行末に動画内タイムスタンプ `[mm:ss]` を付ける。
- 動画の**直接引用**は「」で囲む（引用として追跡される）。
- テーマ見出し（`## 外性器・内性器` など）で分類する。
- 医学的に疑わしい/断定的な主張は、削らずに **`## 要検証・疑わしい主張`** に分けて書く。
- 動画が触れていない項目は「言及なし」と書き、**推測で補完しない**。

## 品質チェック（保存前）
- [ ] 必須メタ5項目がすべて埋まっている
- [ ] 主張にタイムスタンプが付いている
- [ ] 直接引用が「」で示されている
- [ ] 疑わしい主張が別枠に分離されている
- [ ] 推測・脚色で水増ししていない（動画の内容に忠実）

## 注意
- NotebookLMの要約をそのままクイズ化しない。必ず `ingest → 検証 → verified` を経る。
- 対応ファイル形式：Markdown / テキスト(Google Docs書き出し) / PDF / CSV。
- Google Docs から出す場合は「書式なしテキスト」で保存し、先頭に必須メタを付ける。
