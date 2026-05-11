// ── DOM 快捷操作 ───────────────────────────────
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const itemsList = $('#itemsList');
const searchInput = $('#searchInput');
const collectToggle = $('#collectToggle');
const quickCollectBtn = $('#quickCollectBtn');
const settingsBtn = $('#settingsBtn');
const settingsPanel = $('#settingsPanel');
const apiKeyInput = $('#apiKeyInput');
const apiKeySaveBtn = $('#apiKeySaveBtn');
const apiKeyStatus = $('#apiKeyStatus');
const closeBtn = $('#closeBtn');
const collectBadge = $('#collectBadge');
const todayCount = $('#todayCount');
const totalCount = $('#totalCount');
const groupCount = $('#groupCount');
const emptyState = $('#emptyState');

// 详情弹窗
const detailModal = $('#detailModal');
const modalBack = $('#modalBack');
const modalClose = $('#modalClose');
const modalBody = $('#modalBody');
const modalCopyBtn = $('#modalCopyBtn');
const modalAnalyzeBtn = $('#modalAnalyzeBtn');
const modalDeleteBtn = $('#modalDeleteBtn');
const modalAnalysis = $('#modalAnalysis');
const modalAnalysisResult = $('#modalAnalysisResult');

let currentItems = [];
let currentModalItem = null;

// ── 格式化时间 ──────────────────────────────────
function formatTime(dateStr) {
  const d = new Date(dateStr + (dateStr.includes('T') ? '' : ''));
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateFull(dateStr) {
  const d = new Date(dateStr + (dateStr.includes('T') ? '' : ''));
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

// ── 渲染条目列表 ──────────────────────────────────
function renderItem(item) {
  const card = document.createElement('div');
  card.className = 'item-card';
  card.dataset.id = item.id;

  // 类型图标
  const iconDiv = document.createElement('div');
  iconDiv.className = 'item-type-icon';
  if (item.type === 'image') {
    iconDiv.classList.add('img-icon');
    if (item.image_path) {
      iconDiv.innerHTML = `<img src="file://${item.image_path}" loading="lazy" />`;
    } else {
      iconDiv.textContent = '🖼️';
    }
  } else {
    iconDiv.textContent = '📝';
  }

  // 内容主体
  const body = document.createElement('div');
  body.className = 'item-body';

  const content = document.createElement('div');
  content.className = 'item-content';
  if (item.type === 'image') {
    content.textContent = item.content || item.notes || '（图片）';
    if (!item.content && !item.notes) content.classList.add('empty-img');
  } else {
    content.textContent = item.content || item.notes || '（空）';
  }

  const meta = document.createElement('div');
  meta.className = 'item-meta';

  // 标签
  if (item.tags) {
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'item-tags';
    item.tags.split(',').forEach(tag => {
      const t = document.createElement('span');
      t.className = 'item-tag';
      t.textContent = tag.trim();
      tagsDiv.appendChild(t);
    });
    meta.appendChild(tagsDiv);
  }

  // 时间
  const time = document.createElement('span');
  time.className = 'item-time';
  time.textContent = formatTime(item.created_at);
  meta.appendChild(time);

  body.appendChild(content);
  body.appendChild(meta);

  // 删除按钮（悬浮显示）
  const del = document.createElement('button');
  del.className = 'item-delete';
  del.textContent = '✕';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm('删除这条收集？')) {
      window.electronAPI.deleteItem(item.id);
    }
  });

  // 点击查看详情（核心改进！）
  card.addEventListener('click', () => {
    openDetailModal(item);
  });

  card.appendChild(iconDiv);
  card.appendChild(body);
  card.appendChild(del);
  return card;
}

// ── 刷新列表 ──────────────────────────────────
function renderItems(data) {
  const { items, stats, collecting } = data;
  currentItems = items || [];

  // 更新统计
  todayCount.textContent = stats.today;
  totalCount.textContent = stats.total;
  groupCount.textContent = stats.groups;

  // 更新收集状态
  if (collecting) {
    collectBadge.textContent = '收集中';
    collectBadge.classList.remove('off');
  } else {
    collectBadge.textContent = '已暂停';
    collectBadge.classList.add('off');
  }

  // 清空列表
  itemsList.innerHTML = '';
  if (emptyState) itemsList.appendChild(emptyState);

  if (!items || items.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';
  items.forEach(item => {
    itemsList.appendChild(renderItem(item));
  });
}

// ── 搜索 ──────────────────────────────────────
let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = searchInput.value.trim();
    window.electronAPI.searchItems(q);
  }, 300);
});

// ── 清空数据 ──────────────────────────────────
$('#clearBtn').addEventListener('click', async () => {
  if (confirm('确定要清空所有收集数据吗？\n此操作不可撤销！')) {
    if (confirm('再次确认：删除所有已收集的内容？')) {
      await window.electronAPI.clearAll();
    }
  }
});

// ── 设置面板 ──────────────────────────────────
settingsBtn.addEventListener('click', async () => {
  const isOpen = settingsPanel.style.display !== 'none';
  if (isOpen) {
    settingsPanel.style.display = 'none';
    return;
  }
  settingsPanel.style.display = 'block';
  const config = await window.electronAPI.getConfig();
  if (config.hasKey) {
    apiKeyStatus.textContent = `✅ 已配置 (${config.deepseekApiKey})`;
    apiKeyInput.placeholder = '输入新 key 以替换…';
  } else {
    apiKeyStatus.textContent = '❌ 未设置，输入 key 后保存';
    apiKeyInput.placeholder = 'sk-...';
  }
});

apiKeySaveBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    apiKeyStatus.textContent = '⚠️ 请输入 API Key';
    return;
  }
  apiKeySaveBtn.textContent = '保存中…';
  apiKeySaveBtn.disabled = true;
  const result = await window.electronAPI.saveApiKey(key);
  if (result.ok) {
    apiKeyStatus.textContent = '✅ 已保存！AI 分析功能已启用';
    apiKeyInput.value = '';
    apiKeyInput.placeholder = '已保存，输入新 key 可替换';
  } else {
    apiKeyStatus.textContent = '❌ 保存失败';
  }
  apiKeySaveBtn.textContent = '保存';
  apiKeySaveBtn.disabled = false;
});

// ── 快速收集当前剪贴板 ──────────────────────────
quickCollectBtn.addEventListener('click', async () => {
  quickCollectBtn.textContent = '⏳';
  quickCollectBtn.disabled = true;
  const result = await window.electronAPI.quickCollect();
  quickCollectBtn.textContent = '✏️';
  quickCollectBtn.disabled = false;
  if (!result.ok) {
    // 可以加个简单的通知，这里先静默
    quickCollectBtn.textContent = '❌';
    setTimeout(() => { quickCollectBtn.textContent = '✏️'; }, 1500);
  }
});

// ── 切换收集模式 ──────────────────────────────
collectToggle.addEventListener('click', () => {
  window.electronAPI.toggleCollecting();
});

// ── 关闭窗口 ──────────────────────────────────
closeBtn.addEventListener('click', () => {
  window.close();
});

// ── ─── 详情弹窗逻辑 ──────────────────────────

function openDetailModal(item) {
  currentModalItem = item;
  detailModal.classList.add('visible');
  modalAnalysis.style.display = 'none';

  // 填充内容
  let html = '';

  // 内容区
  if (item.type === 'image' && item.image_path) {
    html += `<div class="modal-img-box">
      <img src="file://${item.image_path}" />
    </div>`;
  }

  if (item.content) {
    html += `<div class="modal-section">
      <div class="modal-section-label">📄 内容</div>
      <div class="modal-content-text">${escapeHtml(item.content)}</div>
    </div>`;
  }

  // 元数据
  html += `<div class="modal-meta-grid">`;

  if (item.tags) {
    const tags = item.tags.split(',').map(t => t.trim()).filter(Boolean);
    html += `<div class="modal-meta-item">
      <span class="modal-meta-icon">🏷️</span>
      <div class="modal-meta-content">
        <span class="modal-meta-label">标签</span>
        <div class="modal-tag-list" id="modalTagList">
          ${tags.map(t => `<span class="analysis-tag">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
    </div>`;
  }

  if (item.notes) {
    html += `<div class="modal-meta-item">
      <span class="modal-meta-icon">💬</span>
      <div class="modal-meta-content">
        <span class="modal-meta-label">备注</span>
        <span class="modal-meta-value">${escapeHtml(item.notes)}</span>
      </div>
    </div>`;
  }

  if (item.source_url) {
    html += `<div class="modal-meta-item">
      <span class="modal-meta-icon">🔗</span>
      <div class="modal-meta-content">
        <span class="modal-meta-label">来源</span>
        <span class="modal-meta-value">${escapeHtml(item.source_url)}</span>
      </div>
    </div>`;
  }

  html += `<div class="modal-meta-item">
    <span class="modal-meta-icon">🕐</span>
    <div class="modal-meta-content">
      <span class="modal-meta-label">收集时间</span>
      <span class="modal-meta-value">${formatDateFull(item.created_at)}</span>
    </div>
  </div>`;

  if (item.type) {
    html += `<div class="modal-meta-item">
      <span class="modal-meta-icon">📦</span>
      <div class="modal-meta-content">
        <span class="modal-meta-label">类型</span>
        <span class="modal-meta-value">${item.type === 'image' ? '🖼️ 图片' : '📝 文字'}</span>
      </div>
    </div>`;
  }

  html += `</div>`;

  modalBody.innerHTML = html;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 关闭弹窗
function closeDetailModal() {
  detailModal.classList.remove('visible');
  currentModalItem = null;
}

modalBack.addEventListener('click', closeDetailModal);
modalClose.addEventListener('click', closeDetailModal);
detailModal.addEventListener('click', (e) => {
  if (e.target === detailModal) closeDetailModal();
});

// 键盘关闭
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && detailModal.classList.contains('visible')) {
    closeDetailModal();
  }
});

// ── 详情弹窗操作按钮 ──────────────────────────

// 复制内容
modalCopyBtn.addEventListener('click', () => {
  if (!currentModalItem) return;
  const text = currentModalItem.content || '';
  window.electronAPI.copyToClipboard(text);
  modalCopyBtn.textContent = '✅ 已复制';
  setTimeout(() => { modalCopyBtn.textContent = '📋 复制内容'; }, 2000);
});

// AI 分析
modalAnalyzeBtn.addEventListener('click', async () => {
  if (!currentModalItem) return;
  modalAnalysis.style.display = 'block';
  modalAnalysisResult.innerHTML = '<div class="modal-analysis-loading">🤖 悠仁正在分析…</div>';

  const result = await window.electronAPI.analyzeContent({
    type: currentModalItem.type,
    content: currentModalItem.content || '',
    tags: currentModalItem.tags || null,
  });

  if (result && (result.summary || result.suggested_tags?.length)) {
    let analysisHtml = '';
    if (result.summary) {
      analysisHtml += `<div class="modal-section">
        <div class="modal-section-label">📝 内容摘要</div>
        <div style="color:var(--text-secondary);font-size:12px;line-height:1.6">${escapeHtml(result.summary)}</div>
      </div>`;
    }
    if (result.suggested_tags?.length) {
      analysisHtml += `<div class="modal-section">
        <div class="modal-section-label">🏷️ 建议标签</div>
        <div class="modal-tag-list">
          ${result.suggested_tags.map(t => `<span class="analysis-tag">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>`;
    }
    if (result.related_ids?.length) {
      analysisHtml += `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">
        🔗 关联到 ${result.related_ids.length} 条已有内容
      </div>`;
    }
    modalAnalysisResult.innerHTML = analysisHtml;
  } else {
    modalAnalysisResult.innerHTML = '<div style="color:var(--text-muted);font-size:12px">分析未返回有效结果</div>';
  }
});

// 删除
modalDeleteBtn.addEventListener('click', () => {
  if (!currentModalItem) return;
  if (confirm('确定删除这条收集？')) {
    window.electronAPI.deleteItem(currentModalItem.id);
    closeDetailModal();
  }
});

// ── IPC 监听 ──────────────────────────────────
window.electronAPI.onItems(renderItems);
window.electronAPI.onStatus((data) => {
  if (data.collecting) {
    collectBadge.textContent = '收集中';
    collectBadge.classList.remove('off');
  } else {
    collectBadge.textContent = '已暂停';
    collectBadge.classList.add('off');
  }
});
