---
description: Flourb名古屋（ハーブピーリング・小顔矯正）ブランド運用・Notion更新。flourb-operator → flourb-reviewer の順で起動。
---

Flourb（名古屋・伏見）の依頼として処理してください。

1. `flourb-operator` を Agent tool で起動して案を作らせる
2. 出力を `flourb-reviewer` に渡して評価させる
3. NEEDS_REVISION なら flourb-operator に差し戻し（最大2周）
4. SNS告知は `content-writer` を並列起動

依頼内容:
$ARGUMENTS

留意点:
- LaTokyo トーン（落ち着き・臨床的）との切り分け
- Flourb は美容寄り・軽やか・上質
- 伏見駅徒歩10秒の立地は強み
- 美容系誇大表現（「劇的」「魔法」）は禁止
