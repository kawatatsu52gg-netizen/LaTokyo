# Dashboard 設計書 — 医学コンテンツ制作OS

CLIを内部エンジンとして、一般ユーザーが **ブラウザのDashboardだけ** で運用できるローカルOS。
Knowledge Base を唯一の情報源（SSoT）とし、全表示・全生成はKB由来。

起動：
```bash
python -m src.pipeline dashboard        # http://127.0.0.1:8765/
python -m src.pipeline dashboard 9000   # ポート指定
```

---

## 1. 画面（6機能）と役割
| 画面 | 役割 |
|---|---|
| **Dashboard** | 今日の動画数/NotebookLM待ち/未レビューClaim/レビュー待ちQuiz/公開待ち/生成済みIG・Slide・YT/品質スコア/KB統計 |
| **ワンクリック追加** | 1ボタンで Import→Claim抽出→KB更新→Evidence反映→Quiz/IG/Slide/YT生成→QA→レビュー待ち配置 |
| **Topic Manager** | テーマ一覧＋テーマ別の 動画/Claim/Evidence/Quiz/IG/Slide 数 |
| **Review Center** | Quiz/Instagram/Slides/YouTube をブラウザ確認。Approve/Reject/Edit |
| **Search** | KB横断のキーワード検索（動画/Claim/Evidence/Quiz/Slides/IG） |
| **Daily Report** | 追加動画/KB増加/Claim追加/公開数/レビュー待ち/品質スコアの当日集計 |

---

## 2. UIモック（レイアウト）

```
┌───────────────────────────────────────────────────────────────┐
│ 🩺 医学コンテンツ制作OS   [SSoT = Knowledge Base]   KB: claim45/edge19 │
├───────────────────────────────────────────────────────────────┤
│ [Dashboard] ワンクリック追加  Topic Manager  Review Center  Search  Daily │
├───────────────────────────────────────────────────────────────┤
│  ┌── Dashboard ────────────────────────────────────────────┐   │
│  │ ┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐  │   │
│  │ │今日の動画││NLM待ち  ││未レビュー││レビュー ││公開待ち │  │   │
│  │ │   2     ││   0     ││Claim 51 ││Quiz 35  ││  18     │  │   │
│  │ └─────────┘└─────────┘└─────────┘└─────────┘└─────────┘  │   │
│  │  生成済み: [Instagram 2][Slides 2][YouTube 1][品質 84.4/100]│   │
│  │  KB統計 : Topics7 Sources5 Entities43 Claims27/45 Edges19  │   │
│  └────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘

ワンクリック追加:
  「NotebookLM書き出しを inbox に置く → [▶ 一括実行]」
  ┌ 実行ログ ─────────────────────────────────┐
  │ == 1. Import/Claim抽出 == ...              │
  │ == 3. KB更新 == kb-build 完了              │
  │ == 5. Quiz自動生成(Evidence A) == 15問     │
  │ ※ 新規claimは needs_review（検証待ち）      │
  └──────────────────────────────────────────┘

Review Center（Quiz）:
  [quiz][instagram][slides][youtube]
  ┌ Q-2001  [multiple_choice] [Evidence A]  kb_generated ┐
  │ 問: 陰核複合体を構成する部分は？                       │
  │  A. 亀頭・陰核体・脚・前庭球  ← 正解(緑枠)            │
  │  B. …  C. …  D. …                                   │
  │ 出典: claim CLM-3001 / source PAP-0001,TXT-0001      │
  │ [Approve] [Reject] [Edit]                            │
  └──────────────────────────────────────────────────────┘

Search:  [ 陰部神経            ] [検索]
  関連エンティティ / Claim / Evidence(A/B) / 関連動画 / 論文教科書 / Quiz / IG / Slide
```

（実UIはダーク基調・カード/テーブル/バッジ。`src/dashboard/static/index.html` に実装）

---

## 3. 画面遷移図

```mermaid
flowchart LR
    D[Dashboard] -->|動画を追加| W[ワンクリック追加]
    W -->|一括実行後| R[Review Center]
    D --> T[Topic Manager]
    D --> S[Search]
    D --> DR[Daily Report]
    T -->|テーマ選択| S
    S -->|Quizヒット| R
    R -->|Approve| P[(approved/ 公開待ち)]
    R -->|Reject| X[(rejected/)]
    R -->|Edit→QA| R
    W -.->|新規claim=needs_review| V[医学検証(CLI/verified_claims)]
    V -.-> D
```

ユーザーの基本動線：**Dashboardで状況把握 → ワンクリック追加 → Review Centerで承認 → 公開**。
（新規claimの医学検証だけは責任者がCLI/ファイルで行う＝安全設計。Dashboardは検証待ち件数を表示。）

---

## 4. 技術構成

```
[ブラウザ SPA]  static/index.html（バニラJS・fetch・タブ切替。外部依存なし）
      │  HTTP(JSON)
[APIサーバ]     src/dashboard/server.py（http.server ThreadingHTTPServer・stdlib）
      │  関数呼び出し
[集計/操作/検索] src/dashboard/{stats,actions,search}.py
      │
[内部エンジン]   src/pipeline.py の cmd_*（ingest/kb-build/generate/approve …）
      │
[Single Source of Truth] data/database/kb.db（＋補助: quiz.db, data/*.json, data/content/）
```

- **依存ゼロ**：Python標準ライブラリのみ（`http.server`, `sqlite3`, `json`）。npm/CDN不要。
- **ローカル専用**：`127.0.0.1` バインド。外部公開しない（教育データの保護）。
- **CLIを内部利用**：`actions.py` が `pipeline.cmd_*` を呼び、stdoutログを捕捉して返す。
- **SSoT遵守**：表示・生成はすべてKB/生成物の集計。UIからKBの生データを書き換える口は持たない
  （承認/却下/編集は draft のクイズに限定。事実の追加は検証フローを通す）。

### 主なAPI
| メソッド/パス | 用途 |
|---|---|
| `GET /api/summary` | Dashboard集計 |
| `GET /api/topics` | Topic Manager |
| `GET /api/review?kind=quiz\|instagram\|slides\|youtube` | レビュー対象一覧 |
| `GET /api/search?q=...` | KB横断検索 |
| `GET /api/daily` | Daily Report |
| `GET /api/content?path=...` | 生成物の本文取得 |
| `POST /api/workflow` | ワンクリック一括実行 |
| `POST /api/approve` `{id}` / `POST /api/reject` `{id}` | 承認/却下 |
| `POST /api/edit` `{id,updates}` | draft編集＋QA |

---

## 5. フォルダ構成（Dashboard部分）

```
quiz_system/
├── src/dashboard/
│   ├── server.py            # HTTPサーバ＋ルーティング（stdlib）
│   ├── stats.py             # Dashboard/Topic/Daily の集計（読み取り専用）
│   ├── actions.py           # ワンクリックWF / approve / reject / edit / レビュー一覧
│   ├── search.py            # KB横断検索
│   └── static/
│       └── index.html       # SPA（6画面・バニラJS・自己完結）
├── src/pipeline.py          # `dashboard` コマンドでサーバ起動（内部エンジン）
└── data/                    # kb.db / quiz.db / claims / quizzes / content …（表示元）
```

---

## 6. 実装順序（このOSを組む推奨手順）

1. **集計API（stats.py）**：まず数を出す。Dashboardが動けば運用状況が見える。
2. **HTTPサーバ＋SPA枠（server.py / index.html）**：タブと fetch の骨組み。
3. **Search**：KB横断検索（read中心で副作用なし・安全に足せる）。
4. **Topic Manager**：テーマ別集計（stats再利用）。
5. **Review Center（読み取り）**：draft/kb_generated/コンテンツの表示。
6. **操作系（actions.py）**：approve/reject/edit を接続（draftに限定＝安全）。
7. **ワンクリックWF**：既存 cmd_* を順に呼びログ捕捉。最後に載せる（副作用が最大のため）。
8. **Daily Report**：集計の再利用で仕上げ。
9. **テスト**：`tests/test_dashboard.py`（集計・検索のスモーク）。

> 設計思想：**読み取り→検索→表示→操作→一括処理** の順に、副作用の小さいものから積む。
> こうするとどの段階でも壊れにくく、途中でも実用（状況把握）になる。

---

## 7. 100ジャンル/1000本規模での運用
- 集計は `sqlite3` の索引付きクエリ（`KB_DESIGN.md` 参照）。件数増加に耐える。
- Topic ManagerはテーマIDで集約するため、ジャンル追加は行が増えるだけ。
- Review/Search はページング前提に拡張可能（現状はLIMIT付き）。
- ワンクリックWFは重い処理のため、規模拡大時はバックグラウンド実行＋進捗ポーリングに拡張余地。
- すべてKB由来のため、ジャンル・本数が増えても「同じ知識・同じ出典」で媒体横断の一貫性を保つ。
