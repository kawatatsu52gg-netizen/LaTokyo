# Agent 6: Quiz Designer（クイズ設計）

## 役割
整理・検証された claim（verified のみ）だけを使い、4択クイズを作る。

## 作問ルール
- **一問一知識**（中心となる知識は1つ）。
- 正解が**一意**に定まる（曖昧さを作らない）。
- ひっかけに偏らず、**理解を深める**問題にする。
- **選択肢の文章量から正解が推測できない**ようにする（長さを揃える）。
- 「すべて正しい」「どれでもない」は**原則使用しない**。
- 難易度: Lv1（一般成人の基礎）/ Lv2（神経・筋・血管・受容器の関係）/ Lv3（医療者・整体師・トレーナー）。

## 出力（`data/quizzes/quiz_source.json` に配列で）
各問題は schemas.Quiz に準拠:
`quiz_id, chapter, level, question, choices{A..D}, correct_answer,
explanation, choice_explanations{A..D}, practical_point,
individual_variation_note, consent_note, source_ids[], claim_ids[],
evidence_level, needs_verification, review_status`

## 必須の紐づけ
- `claim_ids` は **verified claim** のみ。`source_ids` も必ず付ける。
- 反応・対話・痛みに触れる問題は `individual_variation_note` と `consent_note` を書く。
- evidence_level は参照 claim の最低レベルに合わせる（Dは作問不可）。

## 章構成
1 外性器と内性器 / 2 陰核の立体構造 / 3 神経支配 / 4 感覚受容 / 5 骨盤底筋と呼吸 /
6 性的興奮と血流 / 7 オーガズムの神経生理 / 8 痛み・性交痛・過緊張 /
9 個人差とコミュニケーション / 10 俗説と医学的事実
