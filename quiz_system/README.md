# 女性の身体・医学教育クイズ生成システム（MVP）

YouTube → NotebookLM で整理した情報を**根拠(出典)として**、成人男性向けに
女性の身体を医学的に正しく学ぶ4択クイズを、検証つきで生成する半自動システムです。

> **運用担当の方へ**：実際の制作運用は [docs/OPERATIONS_MANUAL.md](docs/OPERATIONS_MANUAL.md)
> と [docs/SOP.md](docs/SOP.md) から。文書一覧は [docs/README.md](docs/README.md)。
>
> **一般ユーザーはブラウザのDashboardだけで操作できます**：
> `python -m src.pipeline dashboard` → http://127.0.0.1:8765/ （設計は [docs/DASHBOARD.md](docs/DASHBOARD.md)）。
> Dashboard/ワンクリック追加/Topic Manager/Review Center/Search/**Research Team**/Daily Report の7画面。
>
> **Research Team**（KBに何を足すべきか考える）：`python -m src.pipeline research` または
> Dashboardの「Research Team」タブ。KB完成度(0〜100%)・Knowledge Gap・Evidence Coverage・
> Learning Progress・探索キュー(YouTube/PubMed/Scholar/教科書のクエリ)を提示。
> Learning Designer は `python -m src.pipeline research-design "<主題>"` でコンテンツ一式を生成。
> ※ Research Teamは提案のみ。KBへの追加は人が NotebookLM→検証→KB の流れで行います（SSoT）。

## 初心者向け学習ゲーム（解剖学を知らない一般男性向け）

KBは専門レベルのまま保持し、初心者向けには **自動でやさしい言葉に変換** します。
目的は「くわしい人」ではなく **「安心して話し合えるパートナー」** を育てること。

- 3レベル：**Level1 身体を知る / Level2 仕組みを知る / Level3 相互理解を深める**
- 専門用語は最小・図解前提・1問1知識・小学生でも分かる解説・レベルアップ形式
- ブラウザ版ゲーム：`npm run dev` → **http://127.0.0.1:8765/game** （XP・バッジ・レベル解放）
- 生成：`python -m src.pipeline beginner-course`（`data/content/beginner/`）
- 単一テーマの平易レッスン：`python -m src.pipeline generate beginner "陰核"`
- やさしい言い換えは `data/beginner/glossary.json`（専門語→やさしい言葉）で管理し、
  `src/content/plain.py` が自動変換します。

## クイックスタート（Dashboardを起動）

```bash
cd quiz_system
npm install     # 依存パッケージ不要。オフラインでも一瞬で完了します
npm run dev     # 初回データ準備 → http://127.0.0.1:8765/ でDashboardが開きます
```

`npm run dev` は以下を自動で行います（`scripts/dev.js`）：
1. Python バックエンドの存在確認（Python 3.10+。無ければ案内）
2. 初回データ準備（`kb.db`/`quiz.db` が無ければ、同梱のNotebookLMサンプルを
   取り込み → 検証反映 → クイズ生成 → Knowledge Base 構築 → グラフからクイズ自動生成）
3. ブラウザ用 Dashboard サーバを起動（`127.0.0.1` のみ・外部公開しない）

- ポート変更：`PORT=9000 npm run dev`
- データだけ作り直す：`npm run bootstrap`
- テスト：`npm test`

> **構成**：フロント（`src/dashboard/static/index.html` のSPA）＋ API/エンジンは Python
> 標準ライブラリのみ（`src/dashboard/`, `src/pipeline.py`）。`npm` は起動ランチャーで、
> JS依存パッケージはありません。ブラウザだけで NotebookLM取込→KB→Quiz→Review→承認 まで動きます。

ブラウザだけで完結しない工程（新しい動画のNotebookLM整理、claimの医学的検証）は
[docs/OPERATIONS_MANUAL.md](docs/OPERATIONS_MANUAL.md) と [docs/SOP.md](docs/SOP.md) を参照してください。

> 目的は性的テクニックの一方的な指導ではなく、**女性の身体には大きな個人差がある**ことの理解と、
> パートナーとの**対話・同意・安心感・相互理解**を通じた満足度向上のための**教育**です。
> 制作の絶対ルールは [CLAUDE.md](CLAUDE.md) を参照してください。

## なぜ半自動か（NotebookLM連携の前提）
NotebookLM の一般向け公開API は 2026年時点で提供されていません（Enterprise API のみ／一般APIは準備中）。
公式でない自動化（ブラウザ操作・非公式API）は**採用しません**。そのため、

```
YouTube
  → [人] NotebookLM にURL登録し、要約・引用・ノートを作成
  → [人] Google Docs/Sheets または Markdown/PDF/TXT/CSV で書き出し
  → inbox/notebooklm_exports/ に配置（または Google Drive MCP で取得）
  → [自動] 取り込み → 正規化 → 主張抽出(全件"要検証") → claims.json
  → [検証] Medical Evidence Reviewer が verified を確定（verified_claims.json）
  → [自動] verified主張のみで4択クイズ生成 → drafts（JSON+Markdown）
  → [自動] QA検証 → qa_report.md
  → [人] 承認したものだけ approved へ（approved のみ公開対象）
```

## 対応する書き出し形式
| 形式 | 拡張子 | 備考 |
|---|---|---|
| Markdown | `.md` | 推奨。フロントマター＋タイムスタンプ付き本文 |
| テキスト（Google Docs書き出し等） | `.txt` | Docsを「書式なしテキスト」で書き出したもの |
| PDF | `.pdf` | `pip install pypdf` が入っていれば抽出。無ければ警告してスキップ |
| CSV（Sheets等） | `.csv` | 列 `statement, quote, timestamp` などを想定 |

## NotebookLMからの書き出し手順（毎回同じ形式にする）
- `templates/notebooklm_prompt.md` … NotebookLMのチャットに貼り付ける専用プロンプト（動画から
  医学的主張・解剖用語・神経名・脊髄分節・受容器・刺激種別・性反応・個人差・注意点・タイムスタンプ・
  直接引用・要検証事項・疑わしい主張を抽出）。
- `templates/notebooklm_export_template.md` … 出力を流し込む雛形。先頭の**必須項目**
  （title / youtube_url / channel_name / published_at / notebook_name）を必ず埋める。
- これらが欠けた情報源の claim は verified 化できません（出典追跡のため）。

## セットアップ
依存パッケージは不要（Python 3.10+ 標準ライブラリのみ）。PDFを扱う場合のみ `pip install pypdf`。

```bash
cd quiz_system
cp .env.example .env   # 認証情報が要る場合のみ編集（MVPは不要）
```

## 使い方（あなたが行う操作）

### 1. NotebookLM の書き出しを配置する
`inbox/notebooklm_exports/` に、NotebookLM の要約・引用・ノートを保存します。
`.md/.txt/.csv/.pdf` に対応。`.md/.txt` は先頭に次のフロントマターを付けると出典が追跡できます:

```
---
title: 動画タイトル
youtube_url: https://www.youtube.com/watch?v=XXXX
channel_name: チャンネル名
published_at: 2025-01-01
notebook_name: ノート名
---
（以下、NotebookLM本文。各文に [01:23] のようにタイムスタンプを残すと引用追跡に有効）
```
※ サンプル `SAMPLE_female_pelvic_anatomy.md` が同梱されています。

### 2. 取り込む（要検証の主張として構造化）
```bash
python -m src.pipeline ingest
```
→ `data/sources/sources.json`, `source_index.json`, `data/claims/claims.json`（全件 needs_review）。

### 3. 医学的検証（Medical Evidence Reviewer）＝ 3分類の振り分け
`data/claims/claims.json`（取り込み直後は**全件 needs_review**）を確認し、査読資料と照合して:
- 確定 → `data/claims/verified_claims.json`（`source_quote`・`evidence_level` 必須、D は不可）
- 誤り・俗説 → `data/claims/rejected_claims.json`
- それ以外はそのまま **needs_review**（クイズには使われない）
```bash
python -m src.pipeline load-verified   # verified / rejected を反映
```
> NotebookLMの要約を無条件に事実扱いしません。動画の断定的な主張（例「整体で必ず治る」）は
> rejected に、根拠が弱い主張（例「神経は約8,000本」）は needs_review に振り分けられます。

### 4. クイズを作成する（Quiz Designer）
`data/quizzes/quiz_source.json` に問題定義を書きます（verified な claim_ids のみ参照可）。
```bash
python -m src.pipeline build-quiz
```
→ `data/quizzes/drafts/` に JSON+Markdown、`data/reports/qa_report.md` に QA結果。

### 5. 承認する（人間の医学的確認）
QAレポートを確認し、問題なければ承認します（公開不可の問題は移動できません）。
```bash
python -m src.pipeline approve Q-0001   # drafts → approved
python -m src.pipeline reject  Q-0002   # drafts → rejected
```

### まとめて実行 / 状態確認
```bash
python -m src.pipeline run-all   # ingest→load-verified→build-quiz→status
python -m src.pipeline status
```

## Knowledge Base（テーマ別知識ベース＋ナレッジグラフ）
「動画ごと」ではなく **テーマごと** に知識を蓄積します。複数の動画・論文・教科書を
1つのテーマ（例: 女性器）に紐づけ、エンティティ間をグラフで結び、4種のクイズを自動生成します。
設計の全体像・ER図・スケール方針は [docs/KB_DESIGN.md](docs/KB_DESIGN.md)。

```bash
python -m src.pipeline kb-build            # シード(topics/entities/edges/claims/論文・教科書)→ kb.db 統合
python -m src.pipeline kb-stats            # KB統計(ソース種別/エンティティ/エッジ/エビデンス)
python -m src.pipeline kb-generate A       # Evidence A のグラフから4種クイズを自動生成(draft)
python -m src.pipeline kb-generate A TOP-innervation   # テーマ限定生成も可
```
- 生成物は `data/quizzes/kb_generated/`（**draft・未承認**）。QA/採点/承認は既存フローを通します。
- グラフの例: 陰核亀頭 →(innervated_by) 陰核背神経 →(branch_of) 陰部神経 →(originates_from) S2〜S4。
- 4種: `fill_blank`（穴埋め）/ `multiple_choice`（4択）/ `application`（多段応用）/ `case`（ケース）。
- **Evidence A だけ** で生成でき、各クイズは裏付け `claim_ids` と複数 `source_ids`（動画＋論文＋教科書）に追跡可能。

### KBに追加した項目
Topic / Sub Topic（topics階層）、Anatomy / Nerve / Receptor / Muscle / Hormone / Clinical（entities.etype）、
Evidence（claims/edges の evidence_level）、Source（youtube/paper/textbook）。

## Content Generator（医学コンテンツ生成エンジン）
Knowledge Base を **唯一の情報源(SSoT)** として、同じ知識から14形式を生成します。
生成器は KB(kb.db) のみを参照し、NotebookLM/YouTube/生ファイルは見ません。
設計・テンプレ構成・設計図・CLI一覧・100ジャンル保守は [docs/CONTENT_GENERATOR.md](docs/CONTENT_GENERATOR.md)。

```bash
python -m src.pipeline content-list                 # 生成可能な14形式と別名
python -m src.pipeline generate instagram "陰部神経"  # 1形式を生成
python -m src.pipeline generate slide "骨盤底筋"
python -m src.pipeline generate youtube "陰核"
python -m src.pipeline generate patient "性交痛"
python -m src.pipeline generate quiz "女性器"
python -m src.pipeline content-all "陰核"            # 全14形式を一括生成
```
生成物は `data/content/<主題>/<形式>.md`（出典・エビデンス・安全注記つき）。
14形式: 4択クイズ / Instagramカルーセル / Instagramリール / Threads / X / YouTube台本 /
YouTubeショート / 患者向け資料 / 整体師向け資料 / HALII Academyスライド / ブログ / メール講座 / FAQ / AIチャットボット回答。

**KB更新→全コンテンツ最新化**: `kb-build` でKBを更新し、`content-all "<主題>"` で作り直せば全形式が最新のKB状態から再生成されます（生成はKBの純粋な関数）。
**新形式の追加**: `templates/content/<name>.json` を1枚置くだけ（既存アーキタイプ利用ならコード変更不要）。

## テスト
```bash
python -m unittest -v tests.test_pipeline tests.test_kb tests.test_content
```

## ディレクトリ
```
quiz_system/
  CLAUDE.md, README.md, .env.example
  config/config.json
  inbox/notebooklm_exports/      # 投入口（サンプル同梱）
  agents/                        # 7エージェントの役割定義
  src/
    schemas.py  db.py  pipeline.py
    ingestion/  normalization/  claims/  quiz_generation/  validation/  export/
  data/
    sources/{raw,normalized}/  sources.json  source_index.json
    claims/{claims.json, verified_claims.json}
    quizzes/{drafts,approved,rejected,quiz_source.json}
    reports/  database/quiz.db
  tests/test_pipeline.py
```

## 安全・ガバナンス（実装済み）
- 出典追跡：Quiz は verified な `claim_ids`/`source_ids` 必須。無いと生成されない。
- エビデンス管理：A/B/C/D。**D は公開不可**、公開は原則 B 以上。
- 断定・固定観念の禁止語チェック、選択肢長の偏り検出、重複検出。
- 反応・対話・痛みに触れる章は `consent_note`/`individual_variation_note` を推奨/必須。
- 承認前(draft)は公開データ(approved)に混ざらない。
- 認証情報はコードに書かず `.env`（gitignore済）。Google Drive連携は最小権限MCPを利用。

## Google Drive 連携（任意 / Phase 10）
Claude Code の Google Drive MCP（読み取り）で書き出しを取得できます。
`search_files` → `read_file_content`/`download_file_content` で本文を取得し、
`inbox/notebooklm_exports/` に保存してから `ingest` を実行します。
パスワード・Cookie・ブラウザログイン情報は保存しません。
```
1. NotebookLMの書き出しをDriveの専用フォルダ（読み取り専用共有）に集約
2. .env に GOOGLE_DRIVE_FOLDER_ID を設定（config.google_drive.enabled=true）
3. Claude Code に「Driveの当該フォルダの新規ファイルを取り込んで」と指示
```

## 免責
本システムは**教育目的**です。医療行為・診断ではありません。痛み・出血・持続する不快感などは
医療機関への相談を促す設計です。整体等で性機能障害を治療できると断定しません。
