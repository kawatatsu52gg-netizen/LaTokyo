# Knowledge Base 更新チェックリスト

KBを更新する前後に必ず確認する。KBは唯一の情報源のため、ここでの品質が全コンテンツに波及する。

## A. 取り込み前（ソース）
- [ ] 動画は [YOUTUBE_SELECTION.md](YOUTUBE_SELECTION.md) の採用条件を満たす／除外条件に非該当
- [ ] 必須メタ（title / youtube_url / channel_name / published_at / notebook_name）が揃っている
- [ ] 論文は authors/journal/doi、教科書は publisher/isbn/edition を記録した（該当時）

## B. 取り込み（ingest）
- [ ] `python -m src.pipeline ingest` を実行した
- [ ] ログに「必須メタ欠落」警告が無い
- [ ] 重複（同一URL/同一内容）が正しくスキップされている
- [ ] 生成された claim は全件 `needs_review` になっている

## C. 医学的検証（3分類）— Medical Evidence Reviewer
各 claim について：
- [ ] 教科書・査読論文・ガイドライン等と**照合**した（動画の発言だけで確定しない）
- [ ] `verified` にするものは `source_quote`（引用）と `evidence_level` を記入した
- [ ] **エビデンス D は verified にしていない**（D不可）
- [ ] 断定的/俗説的な主張は `rejected`、未確定は `needs_review` に残した
- [ ] 是正が必要な誤りには、正しい情報の claim を別途作成した（例：整体の効果断定→是正claim）
- [ ] `python -m src.pipeline load-verified` を実行し、verified/rejected 件数が想定通り

## D. エンティティ／グラフ（entities.json / edges.json）
- [ ] 新出概念は正式名称で entity 化し、俗称は `aliases` に登録した（名寄せ）
- [ ] エンティティ種別(etype)が適切（anatomy/nerve/receptor/muscle/hormone/clinical/…）
- [ ] エッジ(relation)が医学的に正しい（例：陰部神経は体性で、副交感へは直結しない）
- [ ] 各エッジに `evidence_level` と裏付け `claim_ids` を付けた
- [ ] エッジのエビデンスは裏付けclaimを超えていない（build時に自動キャップ・警告を確認）

## E. ビルドと確認（kb-build）
- [ ] `python -m src.pipeline kb-build` を実行した
- [ ] `edge_warnings: 0`（裏付けclaimがverifiedでないエッジが無い）
- [ ] `python -m src.pipeline kb-stats` でソース種別・エンティティ・エビデンス内訳が想定通り
- [ ] 主要な主題で `generate faq "<主題>"` 等を試し、事実・出典が正しく出る

## F. 反映（コンテンツ再生成）
- [ ] 影響する主題で `python -m src.pipeline content-all "<主題>"` を再実行した
- [ ] 生成物ヘッダの `kb_version` が更新されている（最新KBから作られた証跡）

## 記録
- 更新日 / 担当 / 追加・変更したソース・claim・edge の件数 / 特記事項（rejectedにした理由等）
