// cloudflare-worker/index.js
// Slack ボタン操作 → GitHub Projects 更新

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body = await request.text();

    // Slack 署名を検証（なりすまし防止）
    if (!await verifySlackSignature(request, body, env.SLACK_SIGNING_SECRET)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const params  = new URLSearchParams(body);
    const payload = JSON.parse(params.get('payload') || '{}');

    // Slack は 3 秒以内に 200 を要求するため、即レスポンスして非同期処理
    ctx.waitUntil(handlePayload(payload, env));
    return new Response('', { status: 200 });
  },
};

// ── Slack 署名検証 ───────────────────────────────────────────────────────────
async function verifySlackSignature(request, body, signingSecret) {
  const timestamp = request.headers.get('x-slack-request-timestamp');
  const signature = request.headers.get('x-slack-signature');
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const sigBase = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sigBase));
  const hex = 'v0=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === signature;
}

// ── ペイロード振り分け ─────────────────────────────────────────────────────────
async function handlePayload(payload, env) {
  const config = JSON.parse(env.PROJECTS_CONFIG || '[]');

  try {
    if (payload.type === 'block_actions')  await handleBlockActions(payload, config, env);
    if (payload.type === 'view_submission') await handleViewSubmission(payload, config, env);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

// ── ブロックアクション（ボタン押下） ─────────────────────────────────────────────
async function handleBlockActions(payload, config, env) {
  const action = payload.actions?.[0];
  if (!action) return;

  // ✅ 完了ボタン
  if (action.action_id === 'complete_task') {
    const { itemId, projectId, statusFieldId, doneOptionId, title } = JSON.parse(action.value);

    await ghGraphQL(env.GH_TOKEN, `
      mutation($pid:ID!,$iid:ID!,$fid:ID!,$oid:String!){
        updateProjectV2ItemFieldValue(input:{
          projectId:$pid, itemId:$iid, fieldId:$fid,
          value:{singleSelectOptionId:$oid}
        }){ projectV2Item{ id } }
      }
    `, { pid: projectId, iid: itemId, fid: statusFieldId, oid: doneOptionId });

    // 操作したユーザーにだけ見えるメッセージ（ephemeral）
    await fetch(payload.response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'ephemeral',
        text: `✅ *${title}* を完了にしました！`,
      }),
    });
  }

  // ＋ タスクを追加ボタン
  if (action.action_id === 'open_add_task_modal') {
    await fetch('https://slack.com/api/views.open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        trigger_id: payload.trigger_id,
        view: buildAddTaskModal(config, payload.channel?.id || ''),
      }),
    });
  }
}

// ── モーダル送信（タスク追加） ─────────────────────────────────────────────────
async function handleViewSubmission(payload, config, env) {
  if (payload.view?.callback_id !== 'add_task_modal') return;

  const values   = payload.view.state.values;
  const title    = values.title?.title_input?.value?.trim();
  const pid      = values.project?.project_select?.selected_option?.value;
  const priority = values.priority?.priority_select?.selected_option?.value || 'medium';
  const due      = values.due?.due_input?.selected_date || null;
  const channel  = payload.view.private_metadata || env.SLACK_CHANNEL_ID;

  const proj = config.find(p => p.pid === pid);
  if (!proj || !title) return;

  // GitHub Projects にドラフト Issue を作成
  const result = await ghGraphQL(env.GH_TOKEN, `
    mutation($pid:ID!,$t:String!){
      addProjectV2DraftIssue(input:{projectId:$pid, title:$t}){
        projectItem{ id }
      }
    }
  `, { pid: proj.projectId, t: title });

  // 確認メッセージを Slack チャンネルに投稿
  if (channel) {
    const priorityLabel = { high:'🔴 高優先', medium:'🟡 中優先', low:'⚪ 低優先' }[priority] || priority;
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📋 新しいタスクを追加しました\n*${title}*\n${proj.emoji} ${proj.name}　${priorityLabel}${due ? `　期日: ${due}` : ''}`,
            },
          },
        ],
      }),
    });
  }
}

// ── タスク追加モーダルの定義 ───────────────────────────────────────────────────
function buildAddTaskModal(config, channelId) {
  return {
    type: 'modal',
    callback_id: 'add_task_modal',
    private_metadata: channelId,
    title:  { type: 'plain_text', text: 'タスクを追加' },
    submit: { type: 'plain_text', text: '追加する' },
    close:  { type: 'plain_text', text: 'キャンセル' },
    blocks: [
      {
        type: 'input',
        block_id: 'title',
        element: {
          type: 'plain_text_input',
          action_id: 'title_input',
          placeholder: { type: 'plain_text', text: '例: スポンサーに連絡する' },
        },
        label: { type: 'plain_text', text: 'タスク名' },
      },
      {
        type: 'input',
        block_id: 'project',
        element: {
          type: 'static_select',
          action_id: 'project_select',
          placeholder: { type: 'plain_text', text: '案件を選択' },
          options: config.map(p => ({
            text:  { type: 'plain_text', text: `${p.emoji} ${p.name}` },
            value: p.pid,
          })),
        },
        label: { type: 'plain_text', text: '案件' },
      },
      {
        type: 'input',
        block_id: 'priority',
        element: {
          type: 'static_select',
          action_id: 'priority_select',
          initial_option: { text: { type: 'plain_text', text: '🟡 中優先' }, value: 'medium' },
          options: [
            { text: { type: 'plain_text', text: '🔴 高優先' }, value: 'high' },
            { text: { type: 'plain_text', text: '🟡 中優先' }, value: 'medium' },
            { text: { type: 'plain_text', text: '⚪ 低優先' }, value: 'low' },
          ],
        },
        label: { type: 'plain_text', text: '優先度' },
      },
      {
        type: 'input',
        block_id: 'due',
        optional: true,
        element: { type: 'datepicker', action_id: 'due_input' },
        label: { type: 'plain_text', text: '期日（任意）' },
      },
    ],
  };
}

// ── GitHub GraphQL ───────────────────────────────────────────────────────────
async function ghGraphQL(token, query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors?.length) throw new Error(data.errors[0].message);
  return data.data;
}
