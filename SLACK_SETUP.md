# Slack 自動化 セットアップガイド

このガイドで以下が完成します：
- 毎朝 7:30 に「今日のタスク」を Slack に自動投稿
- 毎週月曜 7:00 に「今週の目標」サマリーを投稿
- Slack の [✅ 完了] ボタンで GitHub Projects を直接更新
- Slack の [＋ タスクを追加] ボタンでタスクを新規作成

---

## 所要時間：約 30 分

---

## Step 1：Slack App を作成する

1. https://api.slack.com/apps にアクセス → **「Create New App」**
2. **「From scratch」** を選択
3. App Name: `EVENT PM Bot`、ワークスペースを選択 → **「Create App」**

### 1-1. Incoming Webhook（通知用）を有効化

1. 左メニュー **「Incoming Webhooks」** → **「Activate Incoming Webhooks」** を ON
2. 下の **「Add New Webhook to Workspace」** をクリック
3. 通知を投稿したいチャンネルを選択 → **「許可する」**
4. 表示された Webhook URL をコピーして保存

```
例: https://hooks.slack.com/services/T.../B.../xxx
```
→ これが `SLACK_WEBHOOK_URL` になります

### 1-2. Bot Token（ボタン操作用）を取得

1. 左メニュー **「OAuth & Permissions」**
2. **「Scopes」→「Bot Token Scopes」** で以下を追加：
   - `chat:write`
   - `views:open`
   - `channels:read`
3. ページ上部 **「Install to Workspace」** → **「許可する」**
4. `Bot User OAuth Token`（`xoxb-...` で始まる）をコピーして保存

→ これが `SLACK_BOT_TOKEN` になります

### 1-3. Signing Secret を取得

1. 左メニュー **「Basic Information」**
2. **「App Credentials」** の **「Signing Secret」** をコピーして保存

→ これが `SLACK_SIGNING_SECRET` になります

---

## Step 2：Cloudflare Workers をデプロイする

### 2-1. Cloudflare アカウントを作成

https://dash.cloudflare.com/sign-up（無料プランでOK）

### 2-2. Wrangler CLI をインストール

```bash
npm install -g wrangler
wrangler login
```

### 2-3. Worker をデプロイ

```bash
cd cloudflare-worker
wrangler deploy
```

デプロイ完了後、以下のような URL が表示されます：

```
https://event-pm-slack-handler.your-account.workers.dev
```

→ これが Slack の Interactivity URL になります

### 2-4. Worker に Secrets を登録

以下を順番に実行してください。各コマンドの後に値の入力を求められます：

```bash
# Slack 署名検証用
wrangler secret put SLACK_SIGNING_SECRET

# Slack Bot Token
wrangler secret put SLACK_BOT_TOKEN

# GitHub PAT（project スコープ付き）
wrangler secret put GH_TOKEN

# 通知を投稿するチャンネル ID（Slack でチャンネルを右クリック → 「チャンネル ID をコピー」）
wrangler secret put SLACK_CHANNEL_ID

# プロジェクト設定 JSON（次のステップで作成）
wrangler secret put PROJECTS_CONFIG
```

---

## Step 3：PROJECTS_CONFIG を作成する

以下の JSON を作成します。値は GitHub Projects のボード設定画面から確認できます。

```json
[
  {
    "pid": "nagoya",
    "name": "名古屋案件",
    "emoji": "🏙",
    "date": "2026年10月",
    "projectId": "PVT_xxxxxxxxxxxx",
    "statusFieldId": "PVTF_xxxxxxxxxxxx",
    "doneOptionId": "xxxxxxxx"
  },
  {
    "pid": "orisen",
    "name": "オリセン案件",
    "emoji": "🏟",
    "date": "2026年12月",
    "projectId": "PVT_yyyyyyyyyyyy",
    "statusFieldId": "PVTF_yyyyyyyyyyyy",
    "doneOptionId": "yyyyyyyy"
  }
]
```

### 各 ID の調べ方

GitHub で以下の GraphQL クエリを実行してください：
https://docs.github.com/en/graphql/overview/explorer

```graphql
query {
  user(login: "あなたのGitHubユーザー名") {
    projectV2(number: 1) {
      id
      fields(first: 10) {
        nodes {
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name }
          }
        }
      }
    }
  }
}
```

- `id` → `projectId`
- Status フィールドの `id` → `statusFieldId`
- 「完了」オプションの `id` → `doneOptionId`

名古屋（number: 1）とオリセン（number: 2）で2回実行してください。

---

## Step 4：Slack App に Interactivity を設定する

1. https://api.slack.com/apps → EVENT PM Bot を開く
2. 左メニュー **「Interactivity & Shortcuts」**
3. **「Interactivity」** を ON にする
4. **「Request URL」** に Cloudflare Worker の URL を入力：

```
https://event-pm-slack-handler.your-account.workers.dev
```

5. **「Save Changes」**

---

## Step 5：GitHub Actions に Secrets を登録する

GitHub リポジトリ → **Settings → Secrets and variables → Actions**

| Secret 名 | 値 |
|-----------|-----|
| `GH_PROJECT_TOKEN` | GitHub PAT（project スコープ） |
| `SLACK_WEBHOOK_URL` | Step 1-1 で取得した Webhook URL |
| `PROJECTS_CONFIG` | Step 3 で作成した JSON（1行に圧縮） |

**Variables（Secrets ではなく Variables に登録）：**

| Variable 名 | 値 |
|------------|-----|
| `APP_URL` | `https://your-name.github.io/event-pm/` |

---

## Step 6：動作確認

### 手動で通知をテストする

GitHub リポジトリ → **Actions** → **「Slack Task Notifications」** → **「Run workflow」**
→ type: `daily` を選択して実行

Slack に通知が届けば完成です！

### Cloudflare Worker のテスト

Worker の URL に直接 POST リクエストを送っても 401 になりますが、
Slack からのボタン操作は正常に動作します。

Worker のログは：
```bash
wrangler tail
```
でリアルタイム確認できます。

---

## 完成後の動作

| タイミング | Slack に届くもの |
|-----------|----------------|
| 毎朝 7:30 | 今日のタスク一覧（案件別）＋ 各タスクに [✅ 完了] ボタン |
| 毎週月曜 7:00 | 両案件の週次サマリー（進捗率・未完了タスク一覧） |
| タスク完了ボタン押下 | GitHub Projects のステータスが「完了」に更新される |
| ＋ タスク追加ボタン押下 | Slack 上でフォームが開き、送信すると GitHub Projects にタスクが追加される |

---

## トラブルシューティング

**通知が届かない**
→ GitHub Actions のログを確認。`SLACK_WEBHOOK_URL` が正しいか確認。

**ボタンを押しても何も起きない**
→ `wrangler tail` でエラーを確認。`PROJECTS_CONFIG` の JSON が正しいか確認。

**「プロジェクトが見つかりません」エラー**
→ `GH_PROJECT_TOKEN` に `project` スコープが付いているか確認。

---

## ファイル構成

```
event-pm/
├── index.html                              # EVENT PM アプリ本体
├── .github/
│   ├── workflows/
│   │   └── slack-notify.yml               # 通知スケジュール設定
│   └── scripts/
│       └── slack-notify.js                # 通知ロジック
├── cloudflare-worker/
│   ├── index.js                            # ボタン操作ハンドラー
│   └── wrangler.toml                       # Cloudflare 設定
└── SLACK_SETUP.md                          # このファイル
```
