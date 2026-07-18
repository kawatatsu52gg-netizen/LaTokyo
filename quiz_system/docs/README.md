# ドキュメント目次

## 最終ゴール（まず読む）
- **[LEARNING_GOALS.md](LEARNING_GOALS.md)** — 卒業6能力・コンテンツ対応・貢献度監査（`goals-audit`）

## 運用（まずここから）
- **[DASHBOARD.md](DASHBOARD.md)** — 医学コンテンツ制作OS（ブラウザDashboard）UIモック/画面遷移/技術構成/実装順序。`python -m src.pipeline dashboard` で起動
- **[OPERATIONS_MANUAL.md](OPERATIONS_MANUAL.md)** — 第三者スタッフ向け運用マニュアル（役割・コマンド早見・トラブル対応・用語集）
- **[SOP.md](SOP.md)** — 標準作業手順書（選定→NotebookLM→KB→QA→公開の全12工程）

## チェックリスト・基準
- [YOUTUBE_SELECTION.md](YOUTUBE_SELECTION.md) — YouTube動画 選定基準（採用/除外/エビデンス評価）
- [NOTEBOOKLM_GUIDE.md](NOTEBOOKLM_GUIDE.md) — NotebookLM運用ガイド（テンプレートは `../templates/`）
- [KB_UPDATE_CHECKLIST.md](KB_UPDATE_CHECKLIST.md) — Knowledge Base 更新チェックリスト
- [QUIZ_PUBLISH_CHECKLIST.md](QUIZ_PUBLISH_CHECKLIST.md) — クイズ公開チェックリスト
- [CONTENT_WORKFLOW.md](CONTENT_WORKFLOW.md) — Instagram / YouTube / スライド 制作ワークフロー

## 設計（仕組みの理解）
- [KB_DESIGN.md](KB_DESIGN.md) — Knowledge Base 設計（ER図/DB/1000本スケール）
- [CONTENT_GENERATOR.md](CONTENT_GENERATOR.md) — Content Generator 設計（テンプレ/CLI/100ジャンル保守）

---

### 標準フロー（1枚要約）
```
動画選定 → NotebookLM整理 → inbox投入 → ingest → 医学検証(3分類) →
load-verified → kb-build → 生成(build-quiz/kb-generate/generate) →
QA・採点 → review(10観点) → 公開チェック → approve → 公開
```
唯一の情報源は Knowledge Base。全コンテンツはKBからのみ生成し、KB更新で全形式が最新化される。
