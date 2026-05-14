---
description: 経営管理（経費・売上・予約データ・月次KPI）。finance-ops を起動。戦略解釈は strategy-planner に渡す。
---

経営管理（数値）の依頼として処理してください。`finance-ops` を Agent tool で
起動してください。

依頼内容:
$ARGUMENTS

留意点:
- 数値の出所を必ず明記
- 分類不能な経費は判断せず「要川辺判断」に
- 個人情報（顧客名等）はレポートに載せない
- 戦略的な解釈・施策提案は `strategy-planner` に分離して並列起動
- 売上数値の対外開示は司令塔経由で川辺確認
