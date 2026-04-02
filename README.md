[README.md](https://github.com/user-attachments/files/26424796/README.md)
# EVENT PM — プロジェクト進捗ボード

Claude AI × GitHub Pages で動くイベント推進プロジェクト管理ツール。  
**コスト完全ゼロ**（Anthropic APIの個人使用分のみ）で運用できます。

---

## デプロイ手順（5分で完了）

### 1. GitHubにリポジトリを作成

[github.com/new](https://github.com/new) にアクセスし、以下の設定で作成します。

| 項目 | 設定値 |
|------|--------|
| Repository name | `event-pm`（任意） |
| Visibility | **Public**（コスト無料にするため） |
| Initialize | チェックなしでOK |

### 2. ファイルをプッシュ

```bash
git init
git add index.html README.md
git commit -m "feat: EVENT PM 初期セットアップ"
git remote add origin https://github.com/YOUR_NAME/event-pm.git
git push origin main
```

### 3. GitHub Pages を有効化

1. リポジトリの **Settings** タブを開く
2. 左メニューの **Pages** をクリック
3. Source: **Deploy from a branch**
4. Branch: **main** / **/ (root)**
5. **Save** をクリック

数分後に以下のURLでアクセスできます：
```
https://YOUR_NAME.github.io/event-pm/
```

### 4. チームメンバーにURLを共有するだけ

メンバーはURLにアクセスするだけで閲覧できます。  
APIキーやパスコードの設定は不要です。

---

## 初回アクセス（あなただけが設定）

アプリにアクセスすると初回セットアップ画面が表示されます。

| 項目 | 説明 |
|------|------|
| **Anthropic API キー** | AIアシスタント機能に使用。[console.anthropic.com](https://console.anthropic.com) で取得 |
| **編集パスコード** | タスク編集時に入力するコード。チームメンバーには非公開 |

設定はブラウザのlocalStorageに保存されます。GitHubには一切送信されません。

---

## 使い方

### 閲覧者（チームメンバー）
URLにアクセスするだけで、以下を確認できます。
- **本日のタスク** — 今日の作業と進捗メモ
- **ステータス** — 全体進捗率・タスク数
- **ネクストアクション** — 優先順のアクションリスト
- **タスク一覧** — 全タスクのステータス一覧
- **AIアシスタント** — 状況を質問できるBot（要APIキー）

### 更新者（あなた）
サイドバーの「✎ 編集モード」ボタンを押してパスコードを入力すると編集できます。
- タスクの追加・削除・完了マーク
- 「今日のタスク」フラグの切り替え
- 進捗メモ・プロジェクト概要の更新
- ネクストアクションの追加・削除

---

## コスト

| 項目 | 費用 |
|------|------|
| GitHub リポジトリ | **¥0**（パブリック） |
| GitHub Pages | **¥0**（パブリックは無料） |
| AIアシスタント | チャット1回 約0.1〜0.5円（Haiku使用） |

AIはコスト最小の `claude-haiku-4-5` モデルを使用しています。  
月100回チャットしても **約10〜50円** 程度です。

---

## ファイル構成

```
event-pm/
├── index.html   # アプリ本体（これ1ファイルだけでOK）
└── README.md    # このファイル
```
