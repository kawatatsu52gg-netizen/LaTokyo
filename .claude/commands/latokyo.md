---
description: LaTokyo代官山運営（集客広告・SalonBoard・再来・売上）。latokyo-marketer → latokyo-reviewer の順で起動。
---

LaTokyo（代官山・整体サロン）の依頼として処理してください。

1. `latokyo-marketer` を Agent tool で起動して案を作らせる
2. 出力を `latokyo-reviewer` に渡して評価させる
3. NEEDS_REVISION なら latokyo-marketer に差し戻し（最大2周）
4. SNS告知が絡む場合は `content-writer` を並列起動

依頼内容:
$ARGUMENTS

留意点:
- ターゲットは40〜50代女性
- 効能断定 / 押し売り / 不安煽り は禁止
- 医療広告ガイドライン準拠
- 公開前の最終確定は川辺の判断
