# SOP（標準作業手順書）— 医学教育コンテンツ制作

**目的：誰が使っても同じ品質の教育コンテンツを作れる仕組み。**
本SOPは YouTube選定 → NotebookLM → Claude(KB) → QA → 公開 までの全工程を定義する。
関連文書は末尾「関連」を参照。用語は [OPERATIONS_MANUAL.md](OPERATIONS_MANUAL.md) の用語集。

> 大原則
> 1. **出典なき知識は使わない**（すべての主張に source/claim を紐づける）。
> 2. **NotebookLMの要約を事実扱いしない**（取り込み後は全て要検証→人が確定）。
> 3. **Knowledge Base が唯一の情報源**（全コンテンツはKBからのみ生成）。
> 4. **公開前に人間（できれば医療者）の確認を必須**にする。
> 5. 断定を避け、**個人差・同意・安全**を常に添える。

---

## 全体フロー（1本の動画を教材化する流れ）

```
[1] YouTube選定 ──→ [2] NotebookLM取り込み ──→ [3] NotebookLMで整理
        │                                              │
        ▼                                              ▼
[4] Claudeへ投入(inbox) ──→ [5] 取り込み(ingest) ──→ [6] 医学的検証(3分類)
        │                                              │
        ▼                                              ▼
[7] Knowledge Base更新(kb-build) ──→ [8] クイズ/コンテンツ生成 ──→ [9] QA・採点
        │                                              │
        ▼                                              ▼
[10] レビュー(review) ──→ [11] 承認(approve) ──→ [12] 公開
```

各工程には「担当」「入力」「作業」「完了条件(DoD)」がある。以下に定義する。

---

## [1] YouTube選定
- 担当：リサーチ担当
- 基準は [YOUTUBE_SELECTION.md](YOUTUBE_SELECTION.md)（採用/除外/エビデンス評価）。
- 作業：候補動画のURL・タイトル・チャンネル・公開日を「ソース台帳」に記録。
- DoD：採用基準を満たし、除外条件に該当しないことをチェック済み。

## [2] NotebookLMへの取り込み
- 担当：リサーチ担当
- 作業：NotebookLM で新規ノートブックを作成し、動画URLをソース登録。
- DoD：対象動画がソースとして追加され、文字起こし/要約が生成可能な状態。

## [3] NotebookLMでの整理
- 担当：リサーチ担当
- 作業：[templates/notebooklm_prompt.md](../templates/notebooklm_prompt.md) の
  プロンプトを貼り付けて実行し、出力を得る。
  抽出項目：医学的主張／解剖用語／神経名／脊髄分節／受容器／刺激種別／性反応との関係／
  個人差／注意点／タイムスタンプ／直接引用／要検証事項／疑わしい主張。
- DoD：各主張が「1行1知識＋タイムスタンプ」で、疑わしい主張が別枠に分離されている。

## [4] Claudeへの投入
- 担当：リサーチ担当
- 作業：NotebookLM出力を [templates/notebooklm_export_template.md](../templates/notebooklm_export_template.md)
  に流し込み、**必須メタ**（title / youtube_url / channel_name / published_at / notebook_name）を記入。
  ファイル名は内容が分かる名前で `inbox/notebooklm_exports/` に保存。
- DoD：必須メタが埋まっている（欠けると verified 化不可）。

## [5] 取り込み（ingest）
- 担当：オペレーター
- 作業：`python -m src.pipeline ingest`
- 出力：`data/sources/*.json`、`data/claims/claims.json`（**全件 needs_review**）。
- DoD：ログに「必須メタ欠落」警告が無い。claim 件数が妥当。

## [6] 医学的検証（3分類）
- 担当：医学レビュア（Medical Evidence Reviewer。可能なら有資格者）
- 作業：`data/claims/claims.json` を精査し、査読資料・教科書と照合して振り分け：
  - 確定 → `data/claims/verified_claims.json`（`source_quote`・`evidence_level` 必須、**D不可**）
  - 誤り・俗説 → `data/claims/rejected_claims.json`
  - 未確定 → そのまま needs_review
  反映：`python -m src.pipeline load-verified`
- DoD：[KB_UPDATE_CHECKLIST.md](KB_UPDATE_CHECKLIST.md) を全項目クリア。

## [7] Knowledge Base 更新（kb-build）
- 担当：オペレーター
- 作業：エンティティ/エッジに変更があれば `data/kb/*.json` を更新 → `python -m src.pipeline kb-build`
- 確認：`python -m src.pipeline kb-stats`
- DoD：edge警告0、エビデンス内訳が想定通り、[KB_UPDATE_CHECKLIST.md](KB_UPDATE_CHECKLIST.md) 済み。

## [8] クイズ/コンテンツ生成
- 担当：オペレーター
- クイズ：手書きは `data/quizzes/quiz_source.json`→`build-quiz`。
  グラフ自動生成は `python -m src.pipeline kb-generate A`。
- 他形式：`python -m src.pipeline generate <format> "<主題>"` / `content-all "<主題>"`
  （手順は [CONTENT_WORKFLOW.md](CONTENT_WORKFLOW.md)）。
- DoD：生成物が `data/quizzes/` または `data/content/<主題>/` に出力される。

## [9] QA・採点
- 担当：オペレーター＋医学レビュア
- 作業：`build-quiz` はQA＋6観点採点を `data/reports/qa_report.md` に出力。
- DoD：公開不可(⛔)が解消、警告(⚠️)は医学レビュアが確認済み。

## [10] レビュー（review・10観点/100点）
- 担当：医学レビュア
- 作業：`python -m src.pipeline review [SRC-xxxx]` → `data/quizzes/review_candidates.md`。
  総合 **85点以上** かつ重大問題なしのみ公開候補。<85は修正、重大問題は rejected。
- DoD：公開候補が確定し、[QUIZ_PUBLISH_CHECKLIST.md](QUIZ_PUBLISH_CHECKLIST.md) 済み。

## [11] 承認（approve）
- 担当：承認者（責任者。医療者の確認を得た上で）
- 作業：`python -m src.pipeline approve Q-xxxx`（公開不可の問題は移動できない安全設計）。
- DoD：`data/quizzes/approved/` に移動。draftに残っていない。

## [12] 公開
- 担当：配信担当
- 作業：approved のクイズ／`data/content/<主題>/` の各形式を、各媒体の
  最終ガイドライン（[CONTENT_WORKFLOW.md](CONTENT_WORKFLOW.md)）に沿って投稿。
- DoD：公開物に出典・免責・安全注記が保持されている。公開ログを記録。

---

## 更新（動画を追加・修正したとき）
1. [4]〜[7] を実施してKBを更新。
2. `python -m src.pipeline content-all "<主題>"` で全形式を**最新KBから再生成**。
3. [9]〜[11] を再度通す（KBが真実なので、全媒体が矛盾なく更新される）。

## 関連
- [YOUTUBE_SELECTION.md](YOUTUBE_SELECTION.md) / [KB_UPDATE_CHECKLIST.md](KB_UPDATE_CHECKLIST.md)
- [QUIZ_PUBLISH_CHECKLIST.md](QUIZ_PUBLISH_CHECKLIST.md) / [CONTENT_WORKFLOW.md](CONTENT_WORKFLOW.md)
- [OPERATIONS_MANUAL.md](OPERATIONS_MANUAL.md)（スタッフ運用マニュアル・用語集・トラブル対応）
- KB設計 [KB_DESIGN.md](KB_DESIGN.md) / 生成エンジン [CONTENT_GENERATOR.md](CONTENT_GENERATOR.md)
