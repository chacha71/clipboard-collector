const https = require('https');

// ── 用 DeepSeek 分析新内容和已有内容的关联 ─────────
async function analyzeWithGemini(newItem, recentItems) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const context = recentItems.map((item, i) =>
    `[${i + 1}] ${item.type}: ${item.content?.substring(0, 200) || '(图片)'} | 标签: ${item.tags || '无'}`
  ).join('\n');

  const userPrompt = `你是一个知识管理助手。请分析以下新收集的内容是否与已有条目相关，给出建议。

已有条目：
${context || '(无)'}

新内容：
类型: ${newItem.type}
内容: ${newItem.content?.substring(0, 500) || '(图片)'}
标签: ${newItem.tags || '无'}
来源: ${newItem.sourceUrl || '未知'}

请以 JSON 格式回复，不要其他内容：
{
  "related_ids": [],  // 相关的已有条目序号（从1开始），没有则空数组
  "suggested_tags": [], // 建议补充的标签
  "summary": "", // 对这个新内容的简短中文总结（10字以内）
  "group_reason": "" // 如果有关联，说明为什么相关（一句话）
}`;

  try {
    const result = await callDeepSeekAPI(userPrompt, apiKey);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (err) {
    console.error('DeepSeek 分析失败:', err.message);
    return null;
  }
}

// ── 调用 DeepSeek API (OpenAI 兼容格式) ──────────
function callDeepSeekAPI(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是一个知识管理助手，总是以 JSON 格式回复。' },
        { role: 'user', content: prompt }
      ]
    });

    const options = {
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json?.choices?.[0]?.message?.content || '';
          resolve(text);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

// ── 简单的标签匹配关联（备用方案）─────────────────
function findTagOverlap(newTags, existingItem) {
  if (!newTags || !existingItem.tags) return 0;
  const newTagList = newTags.split(',').map(t => t.trim().toLowerCase());
  const existTagList = existingItem.tags.split(',').map(t => t.trim().toLowerCase());
  const overlap = newTagList.filter(t => existTagList.includes(t));
  return overlap.length;
}

module.exports = { analyzeWithGemini, findTagOverlap };
