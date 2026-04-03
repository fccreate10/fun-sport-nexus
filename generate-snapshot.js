const fs   = require('fs');
const path = require('path');

const GH_TOKEN     = process.env.GH_TOKEN;
const PROJECTS_CFG = JSON.parse(process.env.PROJECTS_CONFIG || '[]');
const EXTRA_DATA   = JSON.parse(process.env.EXTRA_DATA      || '{}');

async function ghq(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors?.length) throw new Error(data.errors[0].message);
  return data.data;
}

function toStatusKey(name = '') {
  const n = name.toLowerCase();
  if (['done','完了','completed','closed','finished'].some(k => n.includes(k)))           return 'done';
  if (['review','レビュー','in review','testing','qa'].some(k => n.includes(k)))          return 'review';
  if (['in progress','進行中','doing','wip','active','started'].some(k => n.includes(k))) return 'inprogress';
  return 'todo';
}

async function fetchItems(projectId) {
  const q = `query($pid:ID!){
    node(id:$pid){
      ... on ProjectV2{
        items(first:100){
          nodes{
            id
            content{
              ... on DraftIssue{ title }
              ... on Issue{ title }
            }
            fieldValues(first:15){
              nodes{
                ... on ProjectV2ItemFieldSingleSelectValue{
                  name
                  field{ ... on ProjectV2SingleSelectField{ id name } }
                }
                ... on ProjectV2ItemFieldDateValue{
                  date
                  field{ ... on ProjectV2Field{ name } }
                }
                ... on ProjectV2ItemFieldTextValue{
                  text
                  field{ ... on ProjectV2Field{ name } }
                }
              }
            }
          }
        }
      }
    }
  }`;
  const data = await ghq(q, { pid: projectId });
  return data.node?.items?.nodes || [];
}

function parseItem(item) {
  if (!item.content?.title) return null;
  const fields     = item.fieldValues?.nodes || [];
  const statusNode = fields.find(f => f.name && f.field?.name?.match(/status|ステータス/i));
  const dateNode   = fields.find(f => f.date);
  const assignNode = fields.find(f => f.text && f.field?.name?.match(/assignee|担当/i));
  const tagNode    = fields.find(f => f.name && f.field?.name?.match(/tag|タグ|label|category/i));
  const prioNode   = fields.find(f => f.name && f.field?.name?.match(/priority|優先/i));

  let priority = 'medium';
  if (prioNode?.name) {
    const p = prioNode.name.toLowerCase();
    if (p.includes('high') || p.includes('高')) priority = 'high';
    if (p.includes('low')  || p.includes('低')) priority = 'low';
  }

  return {
    id:       item.id,
    ghItemId: item.id,
    title:    item.content.title,
    status:   toStatusKey(statusNode?.name || ''),
    priority,
    tag:      tagNode?.name    || '',
    assignee: assignNode?.text || '',
    due:      dateNode?.date   || '',
    today:    false,
  };
}

(async () => {
  const snapshot = { generatedAt: new Date().toISOString(), projects: {} };

  for (const cfg of PROJECTS_CFG) {
    const pid = cfg.pid;
    console.log(`[${pid}] 取得中...`);
    try {
      const items = await fetchItems(cfg.projectId);
      const tasks = items.map(parseItem).filter(Boolean);
      snapshot.projects[pid] = {
        tasks,
        nextActions: EXTRA_DATA[pid]?.nextActions || [],
        memo:        EXTRA_DATA[pid]?.memo        || '',
        overview:    EXTRA_DATA[pid]?.overview    || '',
      };
      console.log(`  → ${tasks.length} 件`);
    } catch (e) {
      console.error(`  × ${e.message}`);
      snapshot.projects[pid] = { tasks: [], nextActions: [], memo: '', overview: '' };
    }
  }

  fs.writeFileSync(path.join(process.cwd(), 'snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  console.log('✅ snapshot.json 生成完了');
})();
