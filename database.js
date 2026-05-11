const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

let db = null;
let DATA_DIR = '';
let DB_PATH = '';

// ── 确保数据目录存在 ─────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ── 初始化数据库 ─────────────────────────────────
async function init(dataDir) {
  DATA_DIR = dataDir || path.join(process.cwd(), 'data');
  DB_PATH = path.join(DATA_DIR, 'collector.db');
  ensureDataDir();

  const SQL = await initSqlJs();
  const fileExists = fs.existsSync(DB_PATH);

  if (fileExists) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 建表
  db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      summary TEXT,
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      content TEXT,
      image_path TEXT,
      source_url TEXT,
      tags TEXT,
      notes TEXT,
      group_id INTEGER,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (group_id) REFERENCES groups(id)
    )
  `);

  // 保存到文件
  save();

  return db;
}

// ── 保存到磁盘 ──────────────────────────────────
function save() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ── 更新条目 ────────────────────────────────────
function updateItem(id, fields) {
  if (!db) return null;
  const sets = [];
  const params = [];
  if (fields.content !== undefined) { sets.push('content = ?'); params.push(fields.content); }
  if (fields.tags !== undefined) { sets.push('tags = ?'); params.push(fields.tags); }
  if (fields.notes !== undefined) { sets.push('notes = ?'); params.push(fields.notes); }
  if (fields.sourceUrl !== undefined) { sets.push('source_url = ?'); params.push(fields.sourceUrl); }
  if (fields.imagePath !== undefined) { sets.push('image_path = ?'); params.push(fields.imagePath); }
  if (fields.groupId !== undefined) { sets.push('group_id = ?'); params.push(fields.groupId); }
  if (!sets.length) return getItem(id);

  params.push(id);
  db.run(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`, params);
  save();
  return getItem(id);
}

// ── 添加条目 ────────────────────────────────────
function addItem({ type, content, imagePath, sourceUrl, tags, notes, groupId }) {
  if (!db) return null;

  const stmt = db.prepare(`
    INSERT INTO items (type, content, image_path, source_url, tags, notes, group_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run([type, content || null, imagePath || null, sourceUrl || null, tags || null, notes || null, groupId || null]);
  stmt.free();
  save();

  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  return getItem(id);
}

// ── 获取单个条目 ────────────────────────────────
function getItem(id) {
  if (!db) return null;
  const result = db.exec(`SELECT * FROM items WHERE id = ${id}`);
  if (!result.length || !result[0].values.length) return null;
  return rowToItem(result[0], result[0].values[0]);
}

// ── 获取所有条目（最新在前） ─────────────────────
function getAllItems(limit = 50) {
  if (!db) return [];
  const result = db.exec(`
    SELECT i.*, g.summary as group_summary
    FROM items i
    LEFT JOIN groups g ON i.group_id = g.id
    ORDER BY i.created_at DESC
    LIMIT ${limit}
  `);
  if (!result.length) return [];
  return result[0].values.map(row => rowToItem(result[0], row));
}

// ── 搜索条目 ────────────────────────────────────
function searchItems(query) {
  if (!db) return [];
  const like = `%${query}%`;
  const result = db.exec(`
    SELECT i.*, g.summary as group_summary
    FROM items i
    LEFT JOIN groups g ON i.group_id = g.id
    WHERE i.content LIKE '${like}' OR i.tags LIKE '${like}' OR i.notes LIKE '${like}' OR i.source_url LIKE '${like}'
    ORDER BY i.created_at DESC
    LIMIT 50
  `);
  if (!result.length) return [];
  return result[0].values.map(row => rowToItem(result[0], row));
}

// ── 根据标签查找相关条目 ─────────────────────────
function findRelatedByTags(tags, excludeId) {
  if (!db || !tags) return [];
  const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
  if (!tagList.length) return [];

  const conditions = tagList.map(t => `i.tags LIKE '%${t}%'`).join(' OR ');
  const excludeClause = excludeId ? `AND i.id != ${excludeId}` : '';

  const result = db.exec(`
    SELECT i.*, g.summary as group_summary
    FROM items i
    LEFT JOIN groups g ON i.group_id = g.id
    WHERE (${conditions}) ${excludeClause}
    ORDER BY i.created_at DESC
    LIMIT 20
  `);
  if (!result.length) return [];
  return result[0].values.map(row => rowToItem(result[0], row));
}

// ── 更新分组 ────────────────────────────────────
function updateGroup(itemId, groupId) {
  if (!db) return;
  db.run(`UPDATE items SET group_id = ${groupId || null} WHERE id = ${itemId}`);
  save();
}

// ── 创建分组 ────────────────────────────────────
function createGroup(summary) {
  if (!db) return null;
  db.run(`INSERT INTO groups (summary) VALUES ('${summary || ''}')`);
  save();
  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  return id;
}

// ── 更新分组摘要 ────────────────────────────────
function updateGroupSummary(groupId, summary) {
  if (!db) return;
  const s = summary.replace(/'/g, "''");
  db.run(`UPDATE groups SET summary = '${s}' WHERE id = ${groupId}`);
  save();
}

// ── 获取分组列表 ────────────────────────────────
function getGroups() {
  if (!db) return [];
  const result = db.exec(`
    SELECT g.*, COUNT(i.id) as item_count
    FROM groups g
    LEFT JOIN items i ON i.group_id = g.id
    GROUP BY g.id
    ORDER BY g.created_at DESC
  `);
  if (!result.length) return [];
  return result[0].values.map(row => {
    const cols = result[0].columns;
    const obj = {};
    row.forEach((val, i) => { obj[cols[i]] = val; });
    return obj;
  });
}

// ── 行转对象 ────────────────────────────────────
function rowToItem(meta, row) {
  const cols = meta.columns;
  const obj = {};
  row.forEach((val, i) => { obj[cols[i]] = val; });
  return obj;
}

// ── 删除条目 ────────────────────────────────────
function deleteItem(id) {
  if (!db) return;
  db.run(`DELETE FROM items WHERE id = ${id}`);
  save();
}

// ── 获取数据库统计 ──────────────────────────────
function getStats() {
  if (!db) return { total: 0, today: 0, groups: 0 };
  const total = db.exec("SELECT COUNT(*) FROM items")[0]?.values[0][0] || 0;
  const today = db.exec("SELECT COUNT(*) FROM items WHERE date(created_at) = date('now','localtime')")[0]?.values[0][0] || 0;
  const groups = db.exec("SELECT COUNT(*) FROM groups")[0]?.values[0][0] || 0;
  return { total, today, groups };
}

// ── 清空所有数据 ────────────────────────────────
function clearAll() {
  if (!db) return;
  db.run('DELETE FROM items');
  db.run('DELETE FROM groups');
  save();
}

module.exports = { init, addItem, updateItem, getItem, getAllItems, searchItems, findRelatedByTags, updateGroup, createGroup, updateGroupSummary, getGroups, getStats, deleteItem, clearAll };
