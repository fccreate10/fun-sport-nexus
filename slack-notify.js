// .github/scripts/slack-notify.js
// GitHub Projects → Slack 通知スクリプト

const NOTIFY_TYPE   = process.env.NOTIFY_TYPE || 'daily';
const GH_TOKEN      = process.env.GH_TOKEN;
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL;
const APP_URL       = process.env.APP_URL || 'https://your-name.github.io/event-pm/';
const PROJECTS      = JSON.parse(process.env.PROJECTS_CONFIG || '[]');

// ── GitHub Projects GraphQL ──────────────────────────────────────────────────
async function ghGraphQL(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors?.length) throw new Error(data.errors[0].message);
  return data.data;
}

async function fetchItems(projectId) {
  const q = `query($pid:ID!){
    node(id:$pid){
      ... on ProjectV2{
        items(first:100){
          nodes{
            id
            content{
              ... on DraftIssue{title}
              ... on Issue{title state}
            }
            fieldValues(first:10){
              nodes{
                ... on ProjectV2ItemFieldSingleSelectValue{
                  name optionId
                  field{... on ProjectV2SingleSelectField{id name}}
                }
                ... on ProjectV2ItemFieldDateValue{
                  date
                  field{... on ProjectV2Field{name}}
                }
              }
            }
          }
        }
      }
    }
  }`;
  const data = await ghGraphQL(q, { pid: projectId });
  return data.node?.items?.nodes || [];
}

// ── ステータス判定 ───────────────────────────────────────────────────────────
const DONE_NAMES    = ['完了','done','closed','finished','completed'];
const REVIEW_NAMES  = ['レビュー','review','in review','testing'];
const ACTIVE_NAMES  = ['進行中','in progress','doing','wip','active'];

function getStatusInfo(item) {
  const nodes = item.fieldValues?.nodes || [];
  const statusNode = nodes.find(n => n.name && (
    n.field?.name?.toLowerCase().includes('status') ||
    n.field?.name === 'Status' ||
    n.field?.name === 'ステータス'
  ));
  const name = statusNode?.name || '';
  const lower = name.toLowerCase();
  if (DONE_NAMES.some(d => lower.includes(d)))   return { name, emoji: '✅', done: true };
  if (REVIEW_NAMES.some(r => lower.includes(r))) return { name, emoji: '🟡', done: false };
  if (ACTIVE_NAMES.some(a => lower.includes(a))) return { name, emoji: '🔵', done: false };
  return { name: name || '未着手', emoji: '⚪', done: false };
}

function getDueDate(item) {
  const dateNode = item.fieldValues?.nodes?.find(n => n.date);
  return dateNode?.date || null;
}

function progressBar(done, total) {
  if (total === 0) return '░░░░░░░░░░';
  const pct = done / total;
  const filled = Math.round(pct * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// ── Slack ブロック構築 ───────────────────────────────────────────────────────
async function buildBlocks() {
  const today = new Date();
  const dateStr = today.toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  const isWeekly = NOTIFY_TYPE === 'weekly';
  const blocks = [];

  // ヘッダー
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: isWeekly
        ? `🎯 今週の目標 & プロジェクトサマリー — ${dateStr}`
        : `☀️ 本日のタスク — ${dateStr}`,
    },
  });
  blocks.push({ type: 'divider' });

  for (const proj of PROJECTS) {
    const items = await fetchItems(proj.projectId);
    const allTasks  = items.filter(i => i.content?.title);
    const doneTasks = allTasks.filter(i => getStatusInfo(i).done);
    const openTasks = allTasks.filter(i => !getStatusInfo(i).done);
    const pct       = allTasks.length > 0 ? Math.round(doneTasks.length / allTasks.length * 100) : 0;
    const bar       = progressBar(doneTasks.length, allTasks.length);

    // プロジェクトヘッダー
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${proj.emoji} ${proj.name}*　${proj.date}\n\`${bar}\` *${pct}%*　（${doneTasks.length}/${allTasks.length}件完了）`,
      },
    });

    if (openTasks.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '_未完了タスクはありません_ 🎉' },
      });
    } else {
      // タスク一覧（最大5件）
      const displayTasks = isWeekly ? openTasks.slice(0, 8) : openTasks.slice(0, 5);
      for (const item of displayTasks) {
        const title  = item.content.title;
        const status = getStatusInfo(item);
        const due    = getDueDate(item);
        const dueStr = due ? `　_期日: ${due}_` : '';

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${status.emoji} ${title}${dueStr}`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '✅ 完了' },
            style: 'primary',
            action_id: 'complete_task',
            // Worker がこの値を使って GitHub を更新する
            value: JSON.stringify({
              itemId:       item.id,
              projectId:    proj.projectId,
              statusFieldId:proj.statusFieldId,
              doneOptionId: proj.doneOptionId,
              pid:          proj.pid,
              title,
            }),
          },
        });
      }

      if (openTasks.length > displayTasks.length) {
        blocks.push({
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `他 ${openTasks.length - displayTasks.length} 件のタスクがあります`,
          }],
        });
      }
    }

    blocks.push({ type: 'divider' });
  }

  // アクションボタン行
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text:  { type: 'plain_text', text: '＋ タスクを追加' },
        style: 'primary',
        action_id: 'open_add_task_modal',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '📊 ボードを開く' },
        url:  APP_URL,
      },
    ],
  });

  return blocks;
}

// ── Slack に投稿 ─────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log(`[${NOTIFY_TYPE}] 通知を構築中...`);
    const blocks = await buildBlocks();

    const res = await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Slack webhook failed: ${res.status} — ${body}`);
    }

    console.log(`✅ Slack 通知送信完了（${NOTIFY_TYPE}）`);
  } catch (err) {
    console.error('❌ エラー:', err.message);
    process.exit(1);
  }
})();
