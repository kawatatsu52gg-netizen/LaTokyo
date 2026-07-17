# 運用マニュアル（第三者スタッフ向け）

このマニュアルだけで、初めての担当者でも同じ品質でコンテンツ制作を運用できることを目指す。
**「誰が使っても同じ品質」** が目的。困ったら本書と各チェックリストに戻る。

---

## 0. これは何をするシステムか
YouTube等の動画・論文・教科書から、女性の身体を医学的に正しく学ぶ教育コンテンツを作る仕組み。
中核は **Knowledge Base（KB）= 唯一の情報源**。KBに検証済みの知識を貯め、そこから
クイズ・SNS・動画台本・スライド・患者資料など14形式を生成する。

大原則（暗記すること）：
1. 出典なき知識は使わない
2. NotebookLMの要約を事実扱いしない（必ず人が検証）
3. KBが唯一の情報源（生成物はKBからのみ）
4. 公開前に人間（できれば医療者）の確認必須
5. 断定を避け、個人差・同意・安全を常に添える

---

## 1. 役割（ロール）と責任
| 役割 | 主な担当工程 | 権限 |
|---|---|---|
| リサーチ担当 | 動画選定〜NotebookLM整理〜inbox投入 | ソース追加 |
| オペレーター | ingest / kb-build / 生成 / レポート出力 | コマンド実行 |
| 医学レビュア | claim検証(3分類) / QA確認 / 10観点レビュー | verified/rejected確定 |
| 承認者（責任者） | approve / 公開可否の最終判断 | approve実行 |
| 配信担当 | 各媒体への投稿・公開ログ | 公開 |

小規模運用では兼務可。ただし **「検証」と「承認」は可能な限り分ける**（自己チェックの盲点回避）。

### RACI（主要工程）
| 工程 | 実行 | 承認 |
|---|---|---|
| 動画選定 | リサーチ | 医学レビュア(疑義時) |
| claim検証 | 医学レビュア | 承認者 |
| 生成 | オペレーター | — |
| クイズ公開 | 配信 | 承認者(医療者確認) |

---

## 2. 最初の準備（環境）
- Python 3.10+（追加ライブラリ不要。PDFを使う時のみ `pip install pypdf`）。
- 作業ディレクトリ：`quiz_system/`。
- 認証情報はコードに書かない（`.env` を使用。`.env` は共有・コミットしない）。

動作確認：
```bash
cd quiz_system
python -m src.pipeline status        # 現在の集計が出れば準備OK
python -m src.pipeline content-list  # 生成できる形式の一覧
```

---

## 3. 毎日の標準オペレーション（動画1本を教材化）
詳細は [SOP.md](SOP.md)。要約すると：
```bash
# 1) 動画を選ぶ（YOUTUBE_SELECTION.md の基準）
# 2) NotebookLMで整理（NOTEBOOKLM_GUIDE.md、prompt/templateを使用）
# 3) 出力を inbox/notebooklm_exports/ に保存（必須メタを記入）
python -m src.pipeline ingest            # 4) 取り込み（全件 要検証）
# 5) 医学検証：verified_claims.json / rejected_claims.json に振り分け
python -m src.pipeline load-verified     #    反映
python -m src.pipeline kb-build          # 6) KB更新（KB_UPDATE_CHECKLIST）
python -m src.pipeline kb-stats          #    確認
# 7) クイズ生成
python -m src.pipeline build-quiz                 #    手書き定義から
python -m src.pipeline kb-generate A              #    グラフからEvidence A自動生成
python -m src.pipeline review                     # 8) 10観点レビュー→公開候補
# 9) 公開チェック（QUIZ_PUBLISH_CHECKLIST）→ 承認
python -m src.pipeline approve Q-xxxx
# 10) 他形式の生成（CONTENT_WORKFLOW）
python -m src.pipeline generate instagram "陰核"
python -m src.pipeline content-all "陰核"
```

---

## 4. コマンド早見表
| コマンド | 何をする |
|---|---|
| `ingest` | inboxの書き出しを取り込み、要検証claimを作る |
| `load-verified` | verified_claims / rejected_claims を反映 |
| `build-quiz` | 手書きクイズ定義を検証しdraft化＋QA＋採点レポート |
| `review [SRC-xxxx]` | 10観点/100点評価→ `review_candidates.md`（承認しない） |
| `approve <id>` / `reject <id>` | draftを approved / rejected へ |
| `kb-build` | シード/既存データを kb.db に統合 |
| `kb-stats` | KB統計（ソース種別・エンティティ・エビデンス） |
| `kb-generate A [topic]` | グラフからEvidence A の4種クイズ生成 |
| `generate <形式> "<主題>"` | KBから1形式のコンテンツ生成 |
| `content-all "<主題>"` | 全14形式を一括生成 |
| `content-list` | 生成できる形式と別名の一覧 |
| `status` / `run-all` | 集計 / 取り込み〜生成の一括 |

---

## 5. フォルダの意味（どこに何があるか）
- `inbox/notebooklm_exports/` … NotebookLM書き出しの投入口
- `data/claims/` … `claims.json`(要検証) / `verified_claims.json` / `rejected_claims.json`
- `data/kb/` … KBのシード（topics/entities/edges/kb_claims/sources_extra/topic_sources）
- `data/quizzes/` … `quiz_source.json` / `drafts` `approved` `rejected` / `review_candidates.md` / `kb_generated`
- `data/content/<主題>/` … 生成された各形式のコンテンツ
- `data/reports/` … QA・採点レポート
- `templates/` … NotebookLM用テンプレ、`content/` に14形式テンプレ
- `docs/` … 本マニュアルと各SOP・チェックリスト
- `data/database/` … `quiz.db` / `kb.db`（生成物。共有不要）

---

## 6. 品質ゲート（通過しないと次へ進めない）
1. **取り込みゲート**：必須メタ欠落なし。
2. **検証ゲート**：全claimが verified/needs_review/rejected に振り分け済み。verifiedは出典・エビデンス付き（D不可）。
3. **QAゲート**：`qa_report.md` に公開不可(⛔)が無い。
4. **レビューゲート**：10観点で85点以上（`review_candidates.md`）。
5. **承認ゲート**：責任者（医療者確認）が approve。
チェックリスト：[KB_UPDATE_CHECKLIST.md](KB_UPDATE_CHECKLIST.md) / [QUIZ_PUBLISH_CHECKLIST.md](QUIZ_PUBLISH_CHECKLIST.md)。

---

## 7. トラブル対応（FAQ）
- **ingestで「必須メタ欠落」警告** → 書き出しファイル先頭の title/url/channel/published_at/notebook_name を記入し再実行。
- **build-quizで問題が「除外」される** → 参照 claim_id が verified でない。`load-verified` 済みか、IDの綴りを確認。
- **kb-buildで edge_warnings > 0** → エッジの裏付け claim が verified でない。claim を検証するか、エッジのclaim_idsを修正。
- **generateで「主題が見つからない」** → topic名 か entity名/別名で指定。`kb-stats`／別名(aliases)を確認。
- **generateでfactが空** → その主題に Evidence条件を満たす verified claim が無い。検証を進めるか主題を変える。
- **公開して良いか不安** → [QUIZ_PUBLISH_CHECKLIST.md](QUIZ_PUBLISH_CHECKLIST.md) を1問ずつ。1つでも✗なら公開しない。

---

## 8. やってはいけないこと（禁止事項）
- NotebookLM/YouTubeの内容を検証せずに公開する。
- KB外の情報を生成物に手で足す（SSoT違反）。
- エビデンスDや出典不明の主張を使う。
- 「必ず」「全員」等の断定、性的に煽る表現、テクニック偏重、女性の一括り。
- 整体等で性機能障害を治療できると断定する／受診不要と示唆する。
- 認証情報・個人情報をコードやコミットに含める。

---

## 9. 用語集
- **Source（情報源）**：動画/論文/教科書。`SRC-/PAP-/TXT-` で始まるID。
- **Claim（主張）**：医学的な一文。`CLM-` ID。出典と紐づく。
- **Evidence（エビデンス）**：A(確立)/B(複数研究で一貫)/C(限定的・議論)/D(俗説・不十分)。Dは公開不可。
- **verified / needs_review / rejected**：検証状態（確定/未確定/却下）。
- **Entity（エンティティ）**：知識グラフのノード（陰核・陰部神経など）。種別=anatomy/nerve/receptor/muscle/hormone/clinical等。
- **Edge（エッジ）**：エンティティ間の関係（陰核背神経→(枝)→陰部神経）。
- **KB（Knowledge Base）**：検証済み知識の集約＝唯一の情報源。
- **Bundle**：ある主題についてKBから取り出した知識束（生成の材料）。
- **SSoT**：Single Source of Truth（唯一の真実＝KB）。

---

## 10. 関連文書
- 全体手順：[SOP.md](SOP.md)
- 動画選定：[YOUTUBE_SELECTION.md](YOUTUBE_SELECTION.md)
- NotebookLM：[NOTEBOOKLM_GUIDE.md](NOTEBOOKLM_GUIDE.md)（テンプレは `templates/`）
- KB更新：[KB_UPDATE_CHECKLIST.md](KB_UPDATE_CHECKLIST.md)
- クイズ公開：[QUIZ_PUBLISH_CHECKLIST.md](QUIZ_PUBLISH_CHECKLIST.md)
- 制作ワークフロー：[CONTENT_WORKFLOW.md](CONTENT_WORKFLOW.md)
- 設計：[KB_DESIGN.md](KB_DESIGN.md) / [CONTENT_GENERATOR.md](CONTENT_GENERATOR.md)
