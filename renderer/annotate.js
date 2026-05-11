// ── DOM 引用 ──────────────────────────────────────
const $ = s => document.querySelector(s);
const previewBox = $('#previewBox');
const ocrBox = $('#ocrBox');
const ocrText = $('#ocrText');
const ocrLoading = $('#ocrLoading');
const tagsInput = $('#tagsInput');
const sourceInput = $('#sourceInput');
const notesInput = $('#notesInput');
const saveBtn = $('#saveBtn');
const cancelBtn = $('#cancelBtn');
const copyBtn = $('#copyBtn');
const analyzeBtn = $('#analyzeBtn');
const analysisBox = $('#analysisBox');
const analysisBody = $('#analysisBody');
const analysisLoading = $('#analysisLoading');
const analysisDone = $('#analysisDone');
const analysisNoKey = $('#analysisNoKey');
const analysisSummary = $('#analysisSummary');
const analysisTagList = $('#analysisTagList');
const analysisToggle = $('#analysisToggle');

let currentContent = null;
let ocrResult = '';
let analysisResult = null;
let hasApiKey = false;

// ── 接收新内容 ──────────────────────────────────
window.electronAPI.onNewContent(async (data) => {
  currentContent = data;

  // 显示预览
  if (data.type === 'text') {
    previewBox.className = 'preview-box';
    previewBox.textContent = data.text || '(空)';
  } else if (data.type === 'image' && data.imagePath) {
    previewBox.className = 'preview-box image-preview';
    previewBox.innerHTML = `<img src="file://${data.imagePath}" />`;
    // 自动 OCR
    ocrBox.classList.add('visible');
    ocrLoading.style.display = 'block';
    ocrText.textContent = '';
    window.electronAPI.ocrImage(data.imagePath);
  }

  // 检查 API key 并自动分析
  try {
    const keyCheck = await window.electronAPI.checkApiKey();
    hasApiKey = keyCheck.hasKey;
    if (hasApiKey) {
      analysisBox.classList.add('visible');
      analysisLoading.style.display = 'flex';
      analysisDone.style.display = 'none';
      analysisNoKey.style.display = 'none';
      triggerAnalysis();
    } else {
      analysisBox.classList.add('visible');
      analysisLoading.style.display = 'none';
      analysisDone.style.display = 'none';
      analysisNoKey.style.display = 'block';
    }
  } catch (_) {
    analysisNoKey.style.display = 'block';
  }

  tagsInput.focus();
});

// ── 触发 AI 分析 ──────────────────────────────────
async function triggerAnalysis() {
  if (!currentContent || !hasApiKey) return;
  analyzeBtn.disabled = true;
  analyzeBtn.classList.add('active');

  const result = await window.electronAPI.analyzeContent({
    type: currentContent.type,
    content: currentContent.type === 'text' ? currentContent.text : (ocrResult || ''),
    tags: tagsInput.value.trim() || null,
  });

  analysisResult = result;
  analyzeBtn.disabled = false;

  analysisLoading.style.display = 'none';

  if (result && (result.summary || result.suggested_tags?.length)) {
    analysisDone.style.display = 'block';

    // 摘要
    analysisSummary.textContent = result.summary || '（未生成摘要）';

    // 推荐标签
    analysisTagList.innerHTML = '';
    if (result.suggested_tags?.length) {
      result.suggested_tags.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'analysis-tag';
        span.textContent = tag;
        span.dataset.tag = tag;
        analysisTagList.appendChild(span);
      });
    } else {
      analysisTagList.innerHTML = '<span style="color:var(--text-muted)">（无推荐标签）</span>';
    }
  } else {
    analysisDone.style.display = 'block';
    analysisSummary.textContent = '（分析未返回有效结果）';
    analysisTagList.innerHTML = '';
  }
}

// ── 手动触发分析 ──────────────────────────────────
analyzeBtn.addEventListener('click', () => {
  if (!hasApiKey) {
    analysisNoKey.textContent = '请设置 GEMINI_API_KEY 环境变量后重启应用';
    analysisNoKey.style.display = 'block';
    return;
  }
  analysisLoading.style.display = 'flex';
  analysisDone.style.display = 'none';
  triggerAnalysis();
});

// ── 收起/展开分析 ──────────────────────────────────
analysisToggle.addEventListener('click', () => {
  const body = analysisBody;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  analysisToggle.textContent = isHidden ? '收起' : '展开';
});

// ── 复制内容到剪贴板 ──────────────────────────────
copyBtn.addEventListener('click', () => {
  if (!currentContent) return;
  const text = currentContent.type === 'text'
    ? currentContent.text
    : (ocrResult || '（图片内容）');
  window.electronAPI.copyToClipboard(text);
  copyBtn.textContent = '✅';
  setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
});

// ── 推荐标签点击（事件委托）─────────────────────
analysisTagList.addEventListener('click', (e) => {
  const span = e.target.closest('.analysis-tag');
  if (!span || !span.dataset.tag) return;
  const tag = span.dataset.tag;
  const existing = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
  if (!existing.includes(tag)) {
    existing.push(tag);
    tagsInput.value = existing.join(', ');
    span.classList.add('added');
  }
});

// ── OCR 结果 ──────────────────────────────────────
window.electronAPI.onOcrResult((result) => {
  ocrLoading.style.display = 'none';
  if (result.text) {
    ocrText.textContent = result.text;
    ocrResult = result.text;
    // 如果 OCR 刚完成且还在分析中，重新触发分析（带上 OCR 文本）
    if (hasApiKey && analysisLoading.style.display !== 'none') {
      triggerAnalysis();
    }
  } else {
    ocrText.textContent = '（未识别到文字）';
    ocrText.style.color = 'var(--text-muted)';
  }
});

// ── 保存到收集器 ──────────────────────────────────
saveBtn.addEventListener('click', () => {
  const tags = tagsInput.value.trim();
  const sourceUrl = sourceInput.value.trim();
  const notes = notesInput.value.trim();

  if (!tags && !notes && !sourceUrl) {
    if (!confirm('标签、备注都为空，确定保存到收集器吗？')) return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '添加中…';

  window.electronAPI.saveItem({
    type: currentContent.type,
    content: currentContent.type === 'text' ? currentContent.text : ocrResult,
    imagePath: currentContent.imagePath || null,
    sourceUrl: sourceUrl || null,
    tags: tags || null,
    notes: notes || null,
    itemId: currentContent.itemId || null,  // 传入已自动保存的条目 ID
  });
});

// ── 保存成功反馈 ──────────────────────────────────
window.electronAPI.onItemSaved((result) => {
  if (result && result.ok) {
    saveBtn.textContent = '✅ 已添加';
    setTimeout(() => window.electronAPI.cancelAnnotate(), 600);
  } else {
    saveBtn.disabled = false;
    saveBtn.textContent = '添加到收集器';
    alert('保存失败，请重试');
  }
});

// ── 取消 ──────────────────────────────────────────
cancelBtn.addEventListener('click', () => {
  window.electronAPI.cancelAnnotate();
});

// ── 键盘快捷键 ────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.electronAPI.cancelAnnotate();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveBtn.click();
});
tagsInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sourceInput.focus(); }
});
sourceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); notesInput.focus(); }
});
