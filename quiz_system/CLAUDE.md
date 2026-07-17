# CLAUDE.md — 女性の身体・医学教育クイズ生成システム

このプロジェクトは、YouTube→NotebookLM で整理された情報を**根拠(source/claim)として**、
成人男性向けに女性の身体を医学的に正しく学ぶための4択クイズを、
検証つきで生成する半自動システムです。

## 目的（絶対に外さない軸）
- 性的テクニックを一方的に教えることが目的ではない。
- **女性の身体には大きな個人差がある**ことの理解、パートナーとの**対話・同意・安心感・相互理解**を通じて
  性生活の満足度を高めるための**教育**である。

## 制作の絶対ルール
1. 医学的な主張には**必ず出典(claim_id / source_id)を紐づける**。出典不明の内容から問題を作らない。
2. YouTube動画は**一次的な教材候補**であり、医学的権威そのものではない。
   「NotebookLMがそう回答した」だけでは正しい情報として扱わない。
3. **確立した事実 / 研究上の傾向 / 仮説**を明確に分ける（エビデンスレベル A/B/C/D）。
   - A: 解剖学的に確立 / B: 複数研究で一貫 / C: 限定的・議論あり / D: 仮説・俗説・根拠不十分
   - **Dは公開不可。公開は原則 B 以上**（config: `min_evidence_level_for_publish`）。
4. 女性の反応を**一律に説明しない**（「必ず」「全員」「誰でも」等の断定を禁止）。
5. **同意・相互尊重・コミュニケーション**を中心に置く。
6. 痛みや不快感を**正常なものとして我慢させない**。医療相談が必要な症状は明示する。
7. **整体で性機能障害を治療できると断定しない**。医療行為と教育コンテンツを区別する。
8. 成人向け**教育**コンテンツとして設計。煽情的・達成課題的な表現を避ける。
9. **公開前に人間（できれば医療者）による医学的確認を必須**とする（approved のみ公開）。

## 刺激の記述ルール（Neurophysiology）
刺激は必ず次を区別する: 軽い接触 / 持続圧 / 振動 / 皮膚伸張 / 温度 / 侵害刺激 / 筋・筋膜への機械刺激。
特定の刺激方法が「全員に有効」であるかのような断定は禁止。

## データと状態遷移
- Source(SRC-xxxx) → Claim(CLM-xxxx) → Quiz(Q-xxxx)
- Claim: `needs_review`（抽出直後・全件）→ `verified`（Reviewer確定）/ `rejected`
- Quiz: `draft` → `reviewed`（スキーマ・出典整合）→ `approved`（人間承認）/ `rejected`
- **verified claim を参照しない Quiz は生成しない。approved 以外は公開しない。**

## ディレクトリ
- `inbox/notebooklm_exports/` … NotebookLM書き出しの投入口
- `data/sources/` … sources.json / source_index.json / raw / normalized
- `data/claims/` … claims.json（要検証）/ verified_claims.json（確定版）
- `data/quizzes/{drafts,approved,rejected}/` … クイズ（承認前後を分離）
- `data/quizzes/quiz_source.json` … Quiz Designer が書く問題定義の入力
- `data/reports/` … QAレポート・ログ
- `agents/` … 各エージェントの役割定義

## エージェント（agents/ 参照）
Source Manager / Anatomy Specialist / Neurophysiology Specialist /
Medical Evidence Reviewer / Consent & Communication Reviewer /
Quiz Designer / Quality Assurance

## 実行
```
python -m src.pipeline run-all        # 取り込み→検証済み登録→生成→QA→レポート
python -m src.pipeline approve Q-0001 # 公開可の問題のみ approved へ
```
詳細は README.md。
