# 予約同期システム 連携調査レポート

**対象**: LaTokyo（代官山）予約のダブルブッキング防止
**目的**: Square予約 と HOT PEPPER Beauty／SALON BOARD予約 の相互同期
**作成日**: 2026-07-14
**方針**: コードを書く前に、公式に利用可能な連携手段のみを調査・比較する。
非公開API・スクレイピング・RPA・利用規約違反の自動操作は採用しない。

---

## 0. 結論（先に要点）

| 項目 | 結論 |
| --- | --- |
| Square側の完全自動化 | **可能**（公式Bookings API + Webhookで双方向操作できる） |
| SALON BOARD側の公式API | **存在しない**（読み取り・書き込みともに公開APIなし） |
| 完全な双方向自動同期（案A） | **不可能**（SALON BOARDに書き込みAPIがないため） |
| Googleカレンダー台帳（案B） | **不採用**（SALON BOARDが公式にGoogleカレンダーへ予約枠を閉じられない） |
| 採用案 | **案C（Squareをマスターにした半自動同期）** の“規約準拠版” |
| 外部→Square の検知手段 | SALON BOARDの**公式予約通知メール**（自分の受信箱＝Gmail）を解析 |
| Square→外部 の反映 | 自動書き込み不可のため、**管理者へ通知して手動ブロック**運用 |

> 重要: 市場に出回っている「ホットペッパービューティー連携予約システム」は、
> 公式API連携ではなく**スクレイピング／RPA**で実現しているものが大半です。
> 本プロジェクトの禁止事項に該当するため、それらの方式は採用しません。

---

## 1. Square で実現できること

Squareは**公式のBookings API**を提供しており、予約の読み取り・作成・更新・キャンセル・
Webhook通知まで、双方向同期に必要な機能がすべて揃っています。

### 認証
- **OAuth 2.0**（マルチテナント配布向け）／ **Personal Access Token**（単一事業者向け）
- 本プロジェクトは単一サロン運用のため、初期は **アクセストークン**でも成立。
  将来の拡張・トークン失効対応を見据え、DB設計はOAuth（refresh_token/expires_at）前提にする。

### 利用するAPIエンドポイント

| 機能 | エンドポイント | 用途 |
| --- | --- | --- |
| List Bookings | `GET /v2/bookings` | 予約一覧の取得・突合 |
| Retrieve Booking | `GET /v2/bookings/{id}` | Webは信用せず最新を再取得 |
| Create Booking | `POST /v2/bookings` | 外部予約に対応するブロック枠の作成 |
| Update Booking | `PUT /v2/bookings/{id}` | 予約変更の反映 |
| Cancel Booking | `POST /v2/bookings/{id}/cancel` | キャンセルの反映・枠解放 |
| Search Availability | `POST /v2/bookings/availability/search` | 空き確認 |
| Locations | `GET /v2/locations` | 店舗ID取得 |
| Team | `GET /v2/team-members` / Bookings配下の team-member profiles | スタッフ突合 |
| Catalog | `GET /v2/catalog/...`（`APPOINTMENTS_SERVICE`等） | メニュー・施術時間の取得 |
| Customers | `GET/POST /v2/customers` | 顧客突合（個人情報は最小限） |

### Webhook
- イベント: `booking.created` / `booking.updated`（キャンセルも `booking.updated` として届く）
- **署名検証**あり（`x-square-hmacsha256-signature` ヘッダ、通知URL＋ボディでHMAC-SHA256）
- **Event ID** を持つため冪等排除が可能
- 受信後すぐ200を返し、実処理はジョブキューへ（本設計で実装）

### 必要なOAuthスコープ（seller-level 運用）
- `APPOINTMENTS_READ`, `APPOINTMENTS_ALL_READ` … 予約読み取り・Webhook購読
- `APPOINTMENTS_WRITE`, `APPOINTMENTS_ALL_WRITE` … 予約作成・更新・キャンセル
- `APPOINTMENTS_BUSINESS_SETTINGS_READ` … 営業設定
- `MERCHANT_PROFILE_READ` … Locations
- `CUSTOMERS_READ`, `CUSTOMERS_WRITE` … 顧客（必要範囲のみ）
- `ITEMS_READ` … Catalog（メニュー・時間）

### バージョン / SDK
- Node.js SDK: `square`（npm）**v40系以降**（v40でクライアント構築が全面刷新。破壊的変更あり）
- Square API バージョン: 実装時点の公式推奨安定版（調査時点で **`2025-10-16`**）。
  実装直前に [公式ドキュメント](https://developer.squareup.com/docs/build-basics/versioning-overview) の最新安定版を再確認して固定する。

### Sandbox でのテスト
- Square Developer Dashboard から **Sandbox** のアクセストークン／アプリを発行
- Sandbox専用の Location・Team・Catalog を作成してテスト
- Webhookは Sandbox 用の署名キーが別発行される
- ローカル受信は トンネル（例: `cloudflared` / `ngrok`）でSquareからのPOSTを転送

**出典**:
- Bookings API 概要: https://developer.squareup.com/docs/bookings-api/what-it-is
- Bookings API 利用手順: https://developer.squareup.com/docs/bookings-api/use-the-api
- Bookings Webhook: https://developer.squareup.com/docs/bookings-api/use-webhooks
- `booking.created`: https://developer.squareup.com/reference/square/bookings-api/webhooks/booking.created
- Create Booking: https://developer.squareup.com/reference/square/bookings-api/create-booking
- OAuth権限: https://developer.squareup.com/docs/oauth-api/square-permissions
- Node SDK: https://developer.squareup.com/docs/sdks/nodejs / https://www.npmjs.com/package/square

---

## 2. HOT PEPPER Beauty ／ SALON BOARD で正式に利用できる連携方法

指示された順で確認しました。

| # | 確認した連携手段 | 結果 |
| --- | --- | --- |
| 1 | SALON BOARDの公式API | **公開なし**。外部向けAPIは提供されていない。 |
| 2 | 契約店舗向け／提携サービス向けAPI | **公開情報として存在しない**。パートナー向けAPIプログラムの公表もなし。 |
| 3 | 外部予約システムとの公式連携機能 | **なし**。市販の「HPB連携」製品はスクレイピング/RPAで実現。 |
| 4 | Googleカレンダー等への公式カレンダー連携 | **公式機能なし**。SALON BOARDからGoogleカレンダーへ予約枠を書き出し・ブロックする公式機能は確認できない。 |
| 5 | 予約データのCSV出力 | 顧客・予約情報のCSV出力機能は管理画面上に存在するが、**手動操作**であり自動同期には使えない。リアルタイム性なし。 |
| 6 | 公式通知メールから予約情報を取得 | **利用可能**。SALON BOARDの「予約お知らせメール一覧」に登録したアドレスへ、予約成立時に通知メールが**公式に**送信される。＝自分の受信箱に届く自分宛メールなので、その解析は規約違反にならない。 |
| 7 | API利用申請の要否 | **申請窓口が存在しない**（そもそもAPIがない）。 |

### 判定
> **SALON BOARD／HOT PEPPER Beauty には、予約枠を自動でブロックできる公式の書き込みAPI・
> 公式カレンダー連携は存在しません。** これは市場の複数の解説でも一致しており、
> 「HPB連携」を謳う製品はすべて非公式なスクレイピング／RPAで動いています。

したがって本プロジェクトでは:
- **外部→Squareの“検知”**は、公式に送られてくる**予約通知メール（Gmail）**を情報源にする（合法・低リスク）。
- **Square→外部の“反映”**は、自動書き込み手段が公式に存在しないため、**自動化しない**。
  代わりに管理者へ即時通知し、SALON BOARD上で人が手動ブロックする。

**出典**:
- SALON BOARD 公式: https://salonboard.com/
- サロンボードのAPI有無の解説: https://salon-douki.com/2123
- HPB連携システム比較（=スクレイピング前提）: https://tada-reserve.jp/blog/alignment/
- HPB連携の実態解説: https://reservation-system-comparison.info/column/cooperation-hotpepperbeauty/
- 予約お知らせメール（公式ヘルプ）: https://beauty.help.hotpepper.jp/s/article/000003386

---

## 3. 完全な双方向自動同期は可能か

**不可能です。** 片側（Square）だけが公式APIを持ち、もう片側（SALON BOARD）に
公式の書き込み手段がないため、「両方向とも自動で予約枠を閉じる」ことは
規約を守る限り実現できません。

- Square → SALON BOARD: **自動不可**（書き込みAPI・公式連携なし）→ 手動ブロック運用
- SALON BOARD → Square: **半自動可**（通知メール検知 → Square APIで自動ブロック）

「双方向の自動同期」を謳うにはSALON BOARD側のスクレイピングが必須であり、
本プロジェクトの禁止事項・利用規約に反するため採用しません。

---

## 4. 利用規約上の問題

| 手段 | 規約リスク | 採否 |
| --- | --- | --- |
| Square 公式API/Webhook | 問題なし（公式提供） | 採用 |
| SALON BOARDの公式通知メール（自分宛）の解析 | 低（自分の受信箱の自分宛メール。第三者の非公開データへの不正アクセスに当たらない） | 採用 |
| 管理者への通知（Slack/Gmail/LINE） | 問題なし | 採用 |
| SALON BOARDへのログイン自動化／スクレイピング | **高**（規約違反の可能性・アカウント停止リスク） | **不採用** |
| 非公開API解析 | **高** | **不採用** |
| ログイン情報のコード直書き | **高**（セキュリティ・規約） | **不採用** |

> 注意: 通知メール解析も「HPBの規約でメール転送・自動処理を禁じていないか」を
> 運用者側で最終確認してください。あくまで**自分の受信箱の自分宛メール**を読む行為に留め、
> HPB/SALON BOARDのサーバへ自動アクセスは一切行いません。

---

## 5. 推奨する同期方法（案A/B/C 比較）

### 案A：公式APIによる双方向同期 → ❌ 不採用
SALON BOARDに公式の書き込みAPIが存在しないため、成立しない。

### 案B：Googleカレンダーを共通台帳 → ❌ 不採用
- Square ↔ Googleカレンダー は連携余地があるが、
- **SALON BOARD が Googleカレンダーの予定で予約枠を閉じる公式機能がない**。
- 「カレンダーに表示されるだけで予約枠が閉じない」条件に該当 → 不採用（指示どおり）。

### 案C：Squareをマスターにした半自動同期 → ✅ 採用（規約準拠版）

```
[SALON BOARD / HOT PEPPER Beauty で予約が入る]
        │  （公式の予約通知メールが自分のGmailに届く）
        ▼
   Gmail 受信 → 同期サーバーが解析（日時・メニュー・スタッフを抽出）
        │
        ▼
   Square Bookings API で対応するブロック枠を自動作成 → ダブルブッキング防止

[Square で予約が入る]（booking.created / booking.updated Webhook）
        │
        ▼
   同期サーバーが受信・冪等処理・DB記録
        │
        ▼
   SALON BOARDへ自動書き込みは不可 → 管理者へ即時通知
        │
        ▼
   管理者が SALON BOARD で当該時間帯を手動ブロック（運用手順を提供）
```

**なぜこれが最善か**
- 規約・法令に反しない範囲で、**ダブルブッキングの実害が大きい方向（外部→Square）を自動化**できる。
- Square→外部は自動化できないが、**即時通知＋手順化**で人的ミスを最小化。
- 将来 SALON BOARD が公式APIを出せば、案Aへ差し替え可能な設計にしておく。

---

## 6. 必要なアカウント・APIキー・申請（管理者の準備）

### Square
1. Square アカウント（本番）＋ Square Developer アカウント
2. Developer Dashboardでアプリ作成 → **Sandbox** と **Production** の資格情報を取得
   - Access Token（または OAuth の Client ID / Secret）
   - Webhook Signature Key
   - Location ID
3. Bookings（アポイントメント）機能を有効化し、スタッフ・メニュー・営業時間を設定

### HOT PEPPER Beauty / SALON BOARD
4. SALON BOARD 管理画面 →「予約お知らせメール一覧」に、
   **本システム専用の受信用メールアドレス**を登録（例: 専用Gmail、または既存Gmailのエイリアス）
5. （API申請は不要＝存在しない）

### 通知
6. Slack Incoming Webhook もしくは Gmail送信 もしくは LINE Messaging API のいずれか

### インフラ
7. PostgreSQL（Railway/Render/Cloud Run/Supabase 等）
8. 本番Secret Manager（各PaaSのSecrets機能）

---

## 7. 推奨技術構成

| レイヤ | 採用 |
| --- | --- |
| 言語 | TypeScript |
| ランタイム | Node.js |
| アプリ | **Next.js（App Router）** … 管理画面(UI) と Webhook/API を1アプリに集約し保守性↑ |
| ジョブキュー | DBバックドキュー（`sync_jobs`）＋ワーカー（Railway/Render/Cloud Runの常駐プロセス or cron）。指数バックオフ再試行 |
| DB | PostgreSQL |
| ORM | Prisma |
| Square | `square` Node SDK v40+ |
| メール取得 | Gmail API（本セッションではGmail MCP、本番はGmail APIのwatch/pull） |
| 通知 | Slack / Gmail / LINE Messaging API（選択式） |
| コンテナ | Docker |
| デプロイ | Railway / Render / Cloud Run（常駐ワーカーが必要なため） |
| ローカル | `.env` |
| 本番 | Secret Manager |

---

## 8. 実装予定ファイル一覧

```
docs/integration-investigation.md      # 本レポート（作成済）
README.md                              # 導入手順
.env.example                           # 環境変数テンプレート（トークンは空）
docker-compose.yml                     # ローカル用 Postgres
Dockerfile
package.json / tsconfig.json
prisma/schema.prisma                   # integrations / reservations / reservation_mappings / sync_logs / webhook_events / sync_jobs

src/lib/env.ts                         # 環境変数の検証(zod)
src/lib/db.ts                          # Prisma client
src/lib/crypto.ts                      # トークン暗号化(AES-256-GCM)
src/lib/time.ts                        # Asia/Tokyo <-> UTC 変換, 前後準備時間
src/lib/logger.ts                      # 機密マスキング付きロガー
src/lib/redact.ts                      # payloadの個人情報/トークンマスキング

src/lib/square/client.ts               # Square SDK ラッパ
src/lib/square/webhook.ts              # 署名検証
src/lib/square/bookings.ts             # list/create/update/cancel
src/lib/square/mapper.ts               # Square booking -> 内部reservation

src/lib/salonboard/emailParser.ts      # 予約通知メール -> 予約データ（新規/変更/キャンセル判定）
src/lib/salonboard/ingest.ts           # Gmail取得 -> 冪等登録

src/lib/sync/engine.ts                 # 同期ロジック（枠の解放/確保、競合検出）
src/lib/sync/queue.ts                  # ジョブenqueue/worker、指数バックオフ
src/lib/sync/conflict.ts               # conflict判定・管理者通知
src/lib/notify/index.ts                # Slack/Gmail/LINE 抽象化

src/app/api/webhooks/square/route.ts   # Square Webhook受信（即200→enqueue）
src/app/api/cron/poll-email/route.ts   # メールポーリング（cron）
src/app/api/reservations/...           # 管理画面API
src/app/(admin)/...                    # 管理画面UI
worker/index.ts                        # ジョブワーカー常駐プロセス

tests/...                              # Vitest（テスト項目に対応）
```

---

## 9. セキュリティ上の注意点

- アクセストークン・refresh_tokenは **AES-256-GCMで暗号化**してDB保存（`crypto.ts`）。平文保存しない。
- ログ（`sync_logs.requestPayload/responsePayload`）は **マスキング後**に保存。
  トークン・氏名・電話・メールは伏字化（`redact.ts`）。
- 通知メッセージに顧客の詳細個人情報を載せない（**日時・予約元・メニュー・エラー概要・管理URL**のみ）。
- Webひとつずつ**署名検証**、`webhook_events`で**Event ID重複排除**。
- 管理画面は認証必須（初期はBasic/セッション、将来SSO）。
- Secretは`.env`（ローカル）／Secret Manager（本番）。リポジトリにコミットしない（`.gitignore`）。
- 個人情報は最小限（同期に必要な氏名/連絡先/日時/メニュー/スタッフのみ）。

---

## 10. 管理者が手動で行う必要がある設定

1. Square Developer でアプリ作成、Sandbox/Productionの Access Token・Webhook署名キー・Location ID を取得
2. Square側でスタッフ・メニュー・施術時間・営業時間を設定
3. Square Developer Dashboard で Webhook 通知先URL（`/api/webhooks/square`）を登録し、
   `booking.created` / `booking.updated` を購読
4. SALON BOARD「予約お知らせメール一覧」に本システム専用の受信アドレスを登録
5. 通知先（Slack Webhook / LINE トークン / 送信元Gmail）を用意
6. 管理画面で **サービス時間マッピング**（HPBメニュー名 → 所要時間・前後準備時間）と
   **スタッフマッピング**（HPB表記 → Square team member）を登録
   （※メール解析の精度はこのマッピング設定に依存するため、初期設定が重要）
7. Square→外部が通知されたら、**SALON BOARDで該当枠を手動ブロック**する運用ルールの周知

---

## 付録: 半自動運用で残る限界（正直な明示）

- 外部予約の検知は「通知メールが届いてから」なので、**数十秒〜数分の遅延**がある。
  同一枠にほぼ同時に両側から予約が入る**競合は完全には防げない** → `conflict`として検出し管理者判断に委ねる。
- メール文面のフォーマット変更でパースが壊れる可能性 → パース失敗は捨てずに
  `manual_action_required` として通知し、取りこぼさない設計にする。
- Square→SALON BOARDは人手が入るため、**手動ブロック漏れ**のリスクは運用手順とリマインド通知で低減する。
