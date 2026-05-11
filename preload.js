const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 标注弹窗
  onNewContent: (cb) => ipcRenderer.on('new-content', (_e, data) => cb(data)),
  saveItem: (data) => ipcRenderer.send('save-item', data),
  onItemSaved: (cb) => ipcRenderer.on('item-saved', (_e, data) => cb(data)),
  cancelAnnotate: () => ipcRenderer.send('cancel-annotate'),

  // 内容操作
  copyToClipboard: (text) => ipcRenderer.send('copy-to-clipboard', text),
  analyzeContent: (data) => ipcRenderer.invoke('analyze-content', data),
  checkApiKey: () => ipcRenderer.invoke('check-api-key'),
  ocrImage: (path) => ipcRenderer.send('ocr-image', path),
  onOcrResult: (cb) => ipcRenderer.on('ocr-result', (_e, data) => cb(data)),

  // 快速收集
  quickCollect: () => ipcRenderer.invoke('quick-collect'),

  // 配置
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),

  // 主窗口数据
  getItems: () => ipcRenderer.send('get-items'),
  onItems: (cb) => {
    ipcRenderer.on('items', (_e, data) => cb(data));
    ipcRenderer.send('get-items');
  },
  searchItems: (query) => ipcRenderer.send('search-items', query),
  deleteItem: (id) => ipcRenderer.send('delete-item', id),
  clearAll: () => ipcRenderer.invoke('clear-all'),
  toggleCollecting: () => ipcRenderer.send('toggle-collecting'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, data) => cb(data)),
});
