const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, clipboard, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const database = require('./database');
const ocr = require('./ocr');
const association = require('./association');

// ── 调试日志 ──────────────────────────────────────
function debugLog(msg) {
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync('C:/Users/Administrator/AppData/Roaming/clipboard-collector/debug.log', `[${ts}] ${msg}\n`);
  } catch(_) {}
}

// ── 判断是否为残留的测试数据 ─────────────────────
function isTestData(item) {
  if (!item || !item.content) return false;
  const testPatterns = ['测试', 'test', 'TODO', 'example', 'demo', 'hello'];
  const content = item.content.toLowerCase();
  const tags = (item.tags || '').toLowerCase();
  return testPatterns.some(p => content.includes(p) || tags.includes(p));
}

// ── 状态 ──────────────────────────────────────────
let mainWindow = null;
let annotateWindow = null;
let tray = null;
let collecting = false;
let lastClipboardHash = '';
let lastAnnotateTime = 0;       // 上次弹窗时间戳，防重复弹窗
let pollTimer = null;
let appIsQuitting = false;

let DATA_DIR = '';
let IMAGES_DIR = '';
let CONFIG_PATH = '';

// ── 配置读写 ──────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (_) {}
  return {};
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (_) {}
}

function getApiKey() {
  // 优先用环境变量，其次用配置文件
  return process.env.DEEPSEEK_API_KEY || loadConfig().deepseekApiKey || '';
}

// ── 常量 ──────────────────────────────────────────
const POLL_INTERVAL = 1000;     // 剪贴板轮询间隔 (ms)
const ANNOTATE_COOLDOWN = 3000; // 弹窗冷却时间 (ms)，防止图片反复弹窗
const WIN_WIDTH = 340;
const WIN_HEIGHT = 480;

// ── 确保目录 ─────────────────────────────────────
function ensureDirs() {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
}

// ── 计算剪贴板内容 hash ─────────────────────────
function getClipboardHash() {
  try {
    const text = clipboard.readText();
    if (text) return 'txt:' + crypto.createHash('md5').update(text).digest('hex');

    const img = clipboard.readImage();
    if (!img.isEmpty()) {
      const png = img.toPNG();
      return 'img:' + crypto.createHash('md5').update(png).digest('hex');
    }
  } catch (_) {}
  return '';
}

// ── 获取剪贴板内容 ───────────────────────────────
function getClipboardContent() {
  const text = clipboard.readText();
  if (text) return { type: 'text', content: text };

  const img = clipboard.readImage();
  if (!img.isEmpty()) return { type: 'image', image: img };

  return null;
}

// ── 保存图片到磁盘 ───────────────────────────────
function saveImage(image) {
  const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
  const filepath = path.join(IMAGES_DIR, filename);
  fs.writeFileSync(filepath, image.toPNG());
  return filepath;
}

// ── 创建托盘图标 ─────────────────────────────────
function createTrayIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2, r = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2);
      const i = (y * size + x) * 4;
      if (dist <= r) {
        buf[i] = 255; buf[i+1] = 107; buf[i+2] = 53; buf[i+3] = 255;
      } else {
        buf[i+3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// ── 更新托盘菜单 ─────────────────────────────────
function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: collecting ? '📥 收集模式：开' : '📤 收集模式：关',
      click: toggleCollecting
    },
    { type: 'separator' },
    { label: '显示窗口', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: '退出程序', click: () => { appIsQuitting = true; app.quit(); } },
  ]));
}

// ── 切换收集模式 ─────────────────────────────────
function toggleCollecting() {
  collecting = !collecting;
  updateTrayMenu();

  if (collecting) {
    lastClipboardHash = getClipboardHash();
    startPolling();
    if (mainWindow) mainWindow.webContents.send('status', { collecting: true });
    showNotification('收集模式已开启', '复制内容时会自动弹窗标注');
  } else {
    stopPolling();
    if (mainWindow) mainWindow.webContents.send('status', { collecting: false });
    showNotification('收集模式已关闭', '剪贴板不再自动收集');
  }
}

// ── 开始轮询剪贴板 ───────────────────────────────
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(checkClipboard, POLL_INTERVAL);
}

// ── 停止轮询 ─────────────────────────────────────
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ── 检查剪贴板变化 ───────────────────────────────
function checkClipboard() {
  if (!collecting) return;

  const hash = getClipboardHash();
  if (!hash || hash === lastClipboardHash) return;
  lastClipboardHash = hash;

  const content = getClipboardContent();
  if (!content) return;

  // ★ 自动保存到数据库（先收进来再说）
  let imagePath = null;
  if (content.type === 'image') {
    imagePath = saveImage(content.image);
  }
  const autoItem = database.addItem({
    type: content.type,
    content: content.type === 'text' ? content.content : '',
    imagePath: imagePath,
    sourceUrl: null,
    tags: null,
    notes: null,
    groupId: null,
  });
  // 刷新主窗口，让内容立即显示
  refreshMainWindow();

  // 弹窗标注（传入 autoItem.id，后续保存就是更新了）
  openAnnotateWindow(content, autoItem?.id);
}

// ── 标注弹窗 ─────────────────────────────────────
function openAnnotateWindow(content, existingItemId) {
  // 防重复弹窗：冷却时间内不弹
  const now = Date.now();
  if (now - lastAnnotateTime < ANNOTATE_COOLDOWN) return;
  lastAnnotateTime = now;

  if (annotateWindow) {
    annotateWindow.focus();
    return;
  }
  // 如果是图片，先保存到磁盘（已在 checkClipboard 中做了，但这里兼容直接调用的情况）
  let imagePath = null;
  if (content.type === 'image' && content.image) {
    imagePath = saveImage(content.image);
  }

  try {
    annotateWindow = new BrowserWindow({
      width: 460,
      height: 600,
      resizable: false,
      frame: true,
      alwaysOnTop: true,
      center: true,
      backgroundColor: '#0c0c10',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    annotateWindow.loadFile(path.join(__dirname, 'renderer', 'annotate.html'));

    annotateWindow.once('ready-to-show', () => {
      annotateWindow.show();
      annotateWindow.webContents.send('new-content', {
        type: content.type,
        text: content.type === 'text' ? content.content : '',
        imagePath: imagePath,
        itemId: existingItemId || null,  // 传入已保存的条目 ID
      });
    });

    annotateWindow.on('closed', () => {
      annotateWindow = null;
    });
  } catch (err) {
    debugLog(`创建标注窗口失败: ${err.message}`);
  }
}

// ── 主窗口 ────────────────────────────────────────
function createMainWindow() {
  const displays = screen.getPrimaryDisplay();
  const { x, y, width, height } = displays.workArea;

  mainWindow = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    x: x + width - WIN_WIDTH - 10,
    y: y + 10,
    resizable: false,
    alwaysOnTop: true,
    frame: false,
    transparent: false,
    backgroundColor: '#0c0c10',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    refreshMainWindow();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── 刷新主窗口数据 ───────────────────────────────
function refreshMainWindow() {
  if (!mainWindow) return;
  const items = database.getAllItems(30);
  const stats = database.getStats();
  mainWindow.webContents.send('items', { items, stats, collecting });
}

// ── 系统通知 ─────────────────────────────────────
function showNotification(title, body) {
  try {
    const n = new Notification({ title, body });
    n.show();
  } catch (_) {}
}

// ── 处理新保存的条目 ─────────────────────────────
async function handleNewItem(itemData) {
  try {
    const { type, content, imagePath, sourceUrl, tags, notes } = itemData;

    let groupId = null;
    const recentItems = database.getAllItems(20);
    const tagMatches = recentItems
      .map(item => ({
        item,
        overlap: association.findTagOverlap(tags, item)
      }))
      .filter(m => m.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap);

    if (tagMatches.length > 0 && tagMatches[0].overlap >= 2) {
      groupId = tagMatches[0].item.group_id || database.createGroup('');
    }

    analyzeWithGeminiAsync({ type, content, imagePath, sourceUrl, tags }, recentItems, groupId);

    const newItem = database.addItem({
      type,
      content,
      imagePath,
      sourceUrl,
      tags,
      notes,
      groupId,
    });

    refreshMainWindow();
    return newItem;
  } catch (err) {
    console.error('保存条目失败:', err);
    return null;
  }
}

// ── 后台分析（用 Gemini）─────────────────────────
async function analyzeWithGeminiAsync(newItemData, recentItems, currentGroupId) {
  try {
    const result = await association.analyzeWithGemini(newItemData, recentItems.slice(0, 10));
    if (!result) return;

    // 如果有分组建议
    if (result.related_ids?.length > 0 && !currentGroupId) {
      const relatedItem = recentItems[result.related_ids[0] - 1];
      if (relatedItem) {
        const gid = relatedItem.group_id || database.createGroup(result.group_reason || '');
        // 更新最新一条的分组
        const latest = database.getAllItems(1)[0];
        if (latest) {
          database.updateGroup(latest.id, gid);
          // 把相关的也加进来
          result.related_ids.forEach(idx => {
            const item = recentItems[idx - 1];
            if (item) database.updateGroup(item.id, gid);
          });
          database.updateGroupSummary(gid, result.group_reason || '');
          refreshMainWindow();
        }
      }
    }
  } catch (_) {}
}

// ── IPC 处理 ─────────────────────────────────────
function setupIPC() {
  // 保存条目（更新已有自动保存的条目，补全标签/备注）
  ipcMain.on('save-item', async (event, data) => {
    try {
      if (data.itemId) {
        // 更新已有条目（补全标签、备注、来源）
        database.updateItem(data.itemId, {
          tags: data.tags || null,
          notes: data.notes || null,
          sourceUrl: data.sourceUrl || null,
          content: data.content || undefined,
        });
        // 后台分析
        const recentItems = database.getAllItems(20);
        analyzeWithGeminiAsync(
          { type: data.type, content: data.content, tags: data.tags },
          recentItems,
          null
        );
      } else {
        // 没有 itemId 就走传统的新建流程
        const item = await handleNewItem(data);
        event.reply('item-saved', { ok: true, item });
      }
      refreshMainWindow();
      // 保存后显示主窗口，让用户看到效果
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
      event.reply('item-saved', { ok: true });
    } catch (err) {
      console.error('保存失败:', err);
      event.reply('item-saved', { ok: false, error: String(err) });
    }
    if (annotateWindow && !annotateWindow.isDestroyed()) {
      annotateWindow.close();
    }
  });

  // 取消标注（关闭弹窗后展示主窗口，用户能看到自动保存的内容）
  ipcMain.on('cancel-annotate', () => {
    if (annotateWindow && !annotateWindow.isDestroyed()) {
      annotateWindow.close();
    }
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // 获取所有条目
  ipcMain.on('get-items', (event) => {
    const items = database.getAllItems(30);
    const stats = database.getStats();
    event.reply('items', { items, stats, collecting });
  });

  // 搜索
  ipcMain.on('search-items', (event, query) => {
    const items = query ? database.searchItems(query) : database.getAllItems(30);
    event.reply('items', { items, stats: database.getStats(), collecting });
  });

  // 删除条目
  ipcMain.on('delete-item', (event, id) => {
    database.deleteItem(id);
    refreshMainWindow();
  });

  // 切换收集模式
  ipcMain.on('toggle-collecting', () => {
    toggleCollecting();
  });

  // OCR 识别图片
  ipcMain.on('ocr-image', async (event, imagePath) => {
    const result = await ocr.recognizeImage(imagePath);
    event.reply('ocr-result', result);
  });

  // 复制内容到剪贴板
  ipcMain.on('copy-to-clipboard', (event, text) => {
    if (text) clipboard.writeText(text);
  });

  // AI 分析内容（invoke 模式，返回 Promise）
  ipcMain.handle('analyze-content', async (event, data) => {
    try {
      const recentItems = database.getAllItems(20);
      const result = await association.analyzeWithGemini(
        { type: data.type, content: data.content, tags: data.tags },
        recentItems.slice(0, 10)
      );
      return result || {};
    } catch (err) {
      debugLog(`分析失败: ${err.message}`);
      return {};
    }
  });

  // 检查是否有 API key
  ipcMain.handle('check-api-key', () => {
    return { hasKey: !!getApiKey() };
  });

  // 保存 API key 到配置文件
  ipcMain.handle('save-api-key', (event, key) => {
    const config = loadConfig();
    config.deepseekApiKey = key || '';
    saveConfig(config);
    // 同步到环境变量，让 association.js 能读到
    if (key) process.env.DEEPSEEK_API_KEY = key;
    else delete process.env.DEEPSEEK_API_KEY;
    return { ok: true };
  });

  // 读取配置
  ipcMain.handle('get-config', () => {
    const config = loadConfig();
    return {
      deepseekApiKey: config.deepseekApiKey ? '****' + config.deepseekApiKey.slice(-4) : '',
      hasKey: !!getApiKey(),
    };
  });

  // 快速收集当前剪贴板内容（不弹标注窗口）
  ipcMain.handle('quick-collect', async () => {
    try {
      const content = getClipboardContent();
      if (!content) return { ok: false, error: '剪贴板为空' };

      let imagePath = null;
      if (content.type === 'image') {
        imagePath = saveImage(content.image);
      }

      const newItem = database.addItem({
        type: content.type,
        content: content.type === 'text' ? content.content : '',
        imagePath: imagePath,
        sourceUrl: null,
        tags: null,
        notes: null,
        groupId: null,
      });

      // 更新 hash，避免自动收集重复触发
      lastClipboardHash = getClipboardHash();

      // 后台分析
      const recentItems = database.getAllItems(20);
      analyzeWithGeminiAsync(
        { type: content.type, content: content.content, imagePath, sourceUrl: null, tags: null },
        recentItems,
        null
      );

      refreshMainWindow();
      if (mainWindow) mainWindow.show();
      return { ok: true, item: newItem };
    } catch (err) {
      debugLog(`快速收集失败: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  // 清空所有数据
  ipcMain.handle('clear-all', () => {
    database.clearAll();
    refreshMainWindow();
    return { ok: true };
  });
}

// ── 生命周期 ─────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
  try {
    DATA_DIR = path.join(app.getPath('userData'), 'data');
    IMAGES_DIR = path.join(DATA_DIR, 'images');
    CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
    // 从配置文件加载 API key 到环境变量
    const savedKey = getApiKey();
    if (savedKey) process.env.DEEPSEEK_API_KEY = savedKey;
    ensureDirs();
    await database.init(DATA_DIR);
    // 启动时清理可能的测试数据
    const initialItems = database.getAllItems(50);
    if (initialItems.length > 0 && initialItems.some(isTestData)) {
      database.clearAll();
      debugLog('已清理测试数据');
    }
    setupIPC();
    createMainWindow();
    createTray();
    updateTrayMenu();

    collecting = true;
    lastClipboardHash = getClipboardHash();
    startPolling();
    updateTrayMenu();
    if (mainWindow) mainWindow.webContents.send('status', { collecting: true });
  } catch (err) {
    console.error('启动错误:', err);
    debugLog(`启动错误: ${err.message}`);
  }
});
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('剪贴收集器');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: collecting ? '📥 收集模式：开' : '📤 收集模式：关', click: toggleCollecting },
    { type: 'separator' },
    { label: '显示窗口', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: '退出程序', click: () => { appIsQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => mainWindow?.show());
}

app.on('window-all-closed', () => {});
app.on('activate', () => mainWindow?.show());
app.on('before-quit', () => { appIsQuitting = true; });
