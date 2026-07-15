# LaTokyo 予約同期システム

Square予約 と HOT PEPPER Beauty／SALON BOARD予約 の**ダブルブッキング防止**を目的とした同期システム。

> **必読**: 実装方針は調査結果に基づきます。まず [`docs/integration-investigation.md`](docs/integration-investigation.md) を読んでください。

## 調査結論（要約）

| 項目 | 結論 |
| --- | --- |
| Square 公式 Bookings API | あり（読み書き・Webhook対応、双方向操作が可能） |
| SALON BOARD 公式 API | **なし**（読み取り・書き込みとも公開APIが存在しない） |
| 完全な双方向自動同期 | **不可能**（SALON BOARD側に公式の書き込み手段がない） |
| 採用方式 | **案C（Squareマスター・半自動）の規約準拠版** |

- **外部（HPB/SALON BOARD）→ Square**: SALON BOARDが公式送信する**予約通知メール**（自分の受信箱）を解析し、Squareに自動ブロック枠を作成。
- **Square → 外部**: 自動書き込み手段が公式に存在しないため、**管理者へ通知し手動ブロック**する運用。

> スクレイピング・非公開API・ログイン自動化・RPAは **一切実装しません**（規約違反・アカウント停止リスクのため）。

## 技術構成

TypeScript / Node.js / Next.js (App Router) / PostgreSQL / Prisma / Square Node SDK v40+ / Gmail API / Docker

## セットアップ

```bash
# 1. 依存インストール
npm install

# 2. 環境変数
cp .env.example .env
#   - TOKEN_ENCRYPTION_KEY を生成: openssl rand -base64 32
#   - Square の Sandbox 資格情報, Location ID, Webhook署名キーを設定

# 3. DB（ローカルはdocker-compose等でPostgresを起動）
npm run prisma:migrate

# 4. テスト
npm test

# 5. 開発サーバ / ワーカー
npm run dev      # 管理画面 + Webhook受信
npm run worker   # 同期ジョブワーカー（指数バックオフ再試行）
```

## 現在の実装状況

**実装済み（安全に確定できる範囲）**
- [x] 連携調査レポート（`docs/integration-investigation.md`）
- [x] `.env.example`
- [x] データベース設計（Prisma: integrations / reservations / reservation_mappings / sync_logs / webhook_events / sync_jobs / service_mappings / staff_mappings）
- [x] トークン暗号化（AES-256-GCM, `src/lib/crypto.ts`）
- [x] タイムゾーン処理（Asia/Tokyo↔UTC, 占有枠・前後準備時間・重複判定, `src/lib/time.ts`）
- [x] ログ/通知のマスキング（`src/lib/redact.ts`）
- [x] Square Webhook 署名検証（`src/lib/square/webhook.ts`）
- [x] 上記の自動テスト（`tests/`, 15件 green）

**次の実装（Square資格情報が用意でき次第）**
- [ ] Square SDK クライアント / Bookings 取得・作成・更新・キャンセル
- [ ] Webhook受信エンドポイント（即200 → ジョブenqueue）
- [ ] 冪等ジョブワーカー（指数バックオフ・最大再試行超過で通知）
- [ ] SALON BOARD 予約通知メールの解析・冪等取り込み
- [ ] 競合検出と管理者通知（Slack / Gmail / LINE）
- [ ] 管理画面（本日の予約 / 同期済 / 失敗 / 競合 / 手動対応 / 再同期 / マッピング / ログ）

## 管理者が手動で行う設定

詳細は [`docs/integration-investigation.md` 第10章](docs/integration-investigation.md#10-管理者が手動で行う必要がある設定) を参照。要点:

1. Square Developer でアプリ作成 → Sandbox/Production の Access Token・Webhook署名キー・Location ID を取得
2. Square Dashboard で Webhook 通知先URL を登録し `booking.created` / `booking.updated` を購読
3. SALON BOARD「予約お知らせメール一覧」に本システム専用の受信アドレスを登録
4. 通知先（Slack Webhook / LINE / Gmail）を用意
5. 管理画面でサービス時間・スタッフのマッピングを登録

## セキュリティ

- アクセストークンは AES-256-GCM で暗号化してDB保存（平文禁止）
- ログ・通知は個人情報／トークンをマスキング
- Webhookは署名検証 + Event ID で冪等排除
- Secretは `.env`（ローカル）／Secret Manager（本番）。リポジトリにコミットしない
