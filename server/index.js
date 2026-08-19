import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync } from 'node:crypto';
import { db, rowToPrompt, rowToTag, rowToModel, rowToModelRef, rowToSource, rowToUser } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const TYPES = ['t2i', 't2v', 'i2v']; // 文生图 / 文生视频 / 图生视频
const REF_TYPES = ['lora', 'checkpoint']; // 模型资源类型

// ---------- 密码哈希（使用 Node 内置 crypto，无需额外依赖） ----------

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

function generateSalt() {
  return randomBytes(16).toString('hex');
}

function generateToken() {
  return randomBytes(32).toString('hex');
}

// ---------- 认证中间件 ----------

function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const token = authHeader.slice(7);
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token);
  if (!session) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
  req.userId = session.user_id;
  next();
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getPrompt(userId, id) {
  return rowToPrompt(db.prepare('SELECT * FROM prompts WHERE id = ? AND user_id = ?').get(id, userId));
}

function normalizeTagIds(userId, raw) {
  if (!Array.isArray(raw)) return { error: '标签必须是数组' };
  const ids = [];
  const seen = new Set();
  for (const item of raw) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0) return { error: `无效的标签 id：${item}` };
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length > 20) return { error: '标签最多 20 个' };
  }
  if (ids.length === 0) return { data: [] };
  const placeholders = ids.map(() => '?').join(',');
  const found = db.prepare(`SELECT id FROM tags WHERE user_id = ? AND id IN (${placeholders})`).all(userId, ...ids);
  if (found.length !== ids.length) {
    const foundSet = new Set(found.map((r) => r.id));
    const missing = ids.filter((id) => !foundSet.has(id));
    return { error: `标签不存在：${missing.join(', ')}` };
  }
  return { data: ids };
}

/** 校验并归一化模型资源 id 数组 */
function normalizeModelRefIds(userId, raw) {
  if (!Array.isArray(raw)) return { error: '模型资源必须是数组' };
  const ids = [];
  const seen = new Set();
  for (const item of raw) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0) return { error: `无效的模型资源 id：${item}` };
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) return { data: [] };
  const placeholders = ids.map(() => '?').join(',');
  const found = db.prepare(`SELECT id FROM model_refs WHERE user_id = ? AND id IN (${placeholders})`).all(userId, ...ids);
  if (found.length !== ids.length) {
    const foundSet = new Set(found.map((r) => r.id));
    const missing = ids.filter((id) => !foundSet.has(id));
    return { error: `模型资源不存在：${missing.join(', ')}` };
  }
  return { data: ids };
}

function parseBody(userId, body) {
  const title = String(body?.title ?? '').trim();
  const content = String(body?.content ?? '').trim();
  const type = body?.type;
  const note = String(body?.note ?? '').trim();
  const favorite = body?.favorite ? 1 : 0;
  const url = String(body?.url ?? '').trim();

  if (!title) return { error: '标题不能为空' };
  if (title.length > 200) return { error: '标题过长（最多 200 字）' };
  if (!TYPES.includes(type)) return { error: '类型必须是 t2i / t2v / i2v' };
  if (url.length > 2000) return { error: '链接过长（最多 2000 字）' };

  // 来源必填，按 id 关联（编辑不改 id）
  let sourceId = null;
  if (body?.source_id != null && body.source_id !== '') {
    sourceId = Number(body.source_id);
    if (!Number.isInteger(sourceId) || sourceId <= 0) return { error: '无效的来源 id' };
    if (!db.prepare('SELECT id FROM sources WHERE id = ? AND user_id = ?').get(sourceId, userId)) {
      return { error: '来源不存在' };
    }
  }
  if (sourceId == null) return { error: '请选择来源' };

  const tagsResult = normalizeTagIds(userId, body?.tags);
  if (tagsResult.error) return { error: tagsResult.error };

  let modelId = null;
  if (body?.model_id != null && body.model_id !== '') {
    modelId = Number(body.model_id);
    if (!Number.isInteger(modelId) || modelId <= 0) return { error: '无效的模型 id' };
    if (!db.prepare('SELECT id FROM models WHERE id = ? AND user_id = ?').get(modelId, userId)) {
      return { error: '模型不存在' };
    }
  }

  const modelRefsResult = normalizeModelRefIds(userId, body?.model_refs);
  if (modelRefsResult.error) return { error: modelRefsResult.error };

  return {
    data: {
      title,
      content,
      type,
      note,
      favorite,
      url,
      source_id: sourceId,
      model_id: modelId,
      tags: JSON.stringify(tagsResult.data),
      model_refs: JSON.stringify(modelRefsResult.data),
    },
  };
}

// ---------- 认证 API（无需登录） ----------

app.post('/api/auth/register', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!username) return res.status(400).json({ error: '用户名不能为空' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: '用户名长度 2-20 个字符' });
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) return res.status(400).json({ error: '用户名只能包含字母、数字、下划线、中文' });
  if (!password) return res.status(400).json({ error: '密码不能为空' });
  if (password.length < 6 || password.length > 100) return res.status(400).json({ error: '密码长度 6-100 个字符' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: '用户名已存在' });

  const salt = generateSalt();
  const hash = hashPassword(password, salt);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, password_hash, password_salt) VALUES (?, ?, ?)')
    .run(username, hash, salt);
  const user = rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(Number(lastInsertRowid)));

  const token = generateToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  res.status(201).json({ token, user });
});

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) return res.status(401).json({ error: '用户名或密码错误' });

  const hash = hashPassword(password, row.password_salt);
  if (hash !== row.password_hash) return res.status(401).json({ error: '用户名或密码错误' });

  const token = generateToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, row.id);
  res.json({ token, user: rowToUser(row) });
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json({ user: rowToUser(user) });
});

app.post('/api/auth/logout', auth, (req, res) => {
  const token = req.headers.authorization.slice(7);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

// ---------- 标签 API（需要登录） ----------

app.get('/api/tags', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM tags WHERE user_id = ? ORDER BY sort_order ASC, id ASC').all(req.userId);
  res.json({ items: rows.map(rowToTag) });
});

app.post('/api/tags', auth, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: '标签名不能为空' });
  if (name.length > 30) return res.status(400).json({ error: '标签名过长（最多 30 字）' });
  const existing = db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(req.userId, name);
  if (existing) return res.status(409).json({ error: '标签已存在', id: existing.id });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM tags WHERE user_id = ?').get(req.userId).m;
  const { lastInsertRowid } = db.prepare('INSERT INTO tags (user_id, name, sort_order) VALUES (?, ?, ?)').run(req.userId, name, maxOrder + 1);
  res.status(201).json(rowToTag(db.prepare('SELECT * FROM tags WHERE id = ?').get(Number(lastInsertRowid))));
});

// 标签排序（注意：必须注册在 /api/tags/:id 之前，否则 reorder 会被 :id 路由抢占）
app.put('/api/tags/reorder', auth, (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须是数组' });
  const update = db.prepare('UPDATE tags SET sort_order = ? WHERE id = ? AND user_id = ?');
  const check = db.prepare('SELECT id FROM tags WHERE id = ? AND user_id = ?');
  for (let i = 0; i < ids.length; i++) {
    const id = Number(ids[i]);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: `无效的 id：${ids[i]}` });
    if (!check.get(id, req.userId)) return res.status(404).json({ error: `标签不存在：${id}` });
    update.run(i, id, req.userId);
  }
  res.json({ ok: true });
});

app.put('/api/tags/:id', auth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 id' });
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: '标签名不能为空' });
  if (name.length > 30) return res.status(400).json({ error: '标签名过长（最多 30 字）' });
  const row = db.prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!row) return res.status(404).json({ error: '标签不存在' });
  const dup = db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ? AND id != ?').get(req.userId, name, id);
  if (dup) return res.status(409).json({ error: '标签名已存在' });
  db.prepare('UPDATE tags SET name = ? WHERE id = ? AND user_id = ?').run(name, id, req.userId);
  res.json(rowToTag(db.prepare('SELECT * FROM tags WHERE id = ?').get(id)));
});

app.delete('/api/tags/:id', auth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 id' });
  const row = db.prepare('SELECT id FROM tags WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!row) return res.status(404).json({ error: '标签不存在' });
  db.prepare('DELETE FROM tags WHERE id = ? AND user_id = ?').run(id, req.userId);
  // 从当前用户的 prompts 中移除该标签 id
  const prompts = db.prepare('SELECT id, tags FROM prompts WHERE user_id = ?').all(req.userId);
  const update = db.prepare('UPDATE prompts SET tags = ?, updated_at = datetime("now", "localtime") WHERE id = ? AND user_id = ?');
  for (const p of prompts) {
    const ids = JSON.parse(p.tags || '[]').filter((t) => t !== id);
    update.run(JSON.stringify(ids), p.id, req.userId);
  }
  res.json({ ok: true });
});

// ---------- 模型 API（需要登录） ----------

app.get('/api/models', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM models WHERE user_id = ? ORDER BY sort_order ASC, id ASC').all(req.userId);
  res.json({ items: rows.map(rowToModel) });
});

app.post('/api/models', auth, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const note = String(req.body?.note ?? '').trim();
  if (!name) return res.status(400).json({ error: '模型名不能为空' });
  if (name.length > 100) return res.status(400).json({ error: '模型名过长（最多 100 字）' });
  if (note.length > 500) return res.status(400).json({ error: '备注过长（最多 500 字）' });
  const existing = db.prepare('SELECT id FROM models WHERE user_id = ? AND name = ?').get(req.userId, name);
  if (existing) return res.status(409).json({ error: '模型已存在', id: existing.id });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM models WHERE user_id = ?').get(req.userId).m;
  const { lastInsertRowid } = db.prepare('INSERT INTO models (user_id, name, note, sort_order) VALUES (?, ?, ?, ?)').run(req.userId, name, note, maxOrder + 1);
  res.status(201).json(rowToModel(db.prepare('SELECT * FROM models WHERE id = ?').get(Number(lastInsertRowid))));
});

// 模型排序（注意：必须注册在 /api/models/:id 之前，否则 reorder 会被 :id 路由抢占）
app.put('/api/models/reorder', auth, (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须是数组' });
  const update = db.prepare('UPDATE models SET sort_order = ? WHERE id = ? AND user_id = ?');
  const check = db.prepare('SELECT id FROM models WHERE id = ? AND user_id = ?');
  for (let i = 0; i < ids.length; i++) {
    const id = Number(ids[i]);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: `无效的 id：${ids[i]}` });
    if (!check.get(id, req.userId)) return res.status(404).json({ error: `模型不存在：${id}` });
    update.run(i, id, req.userId);
  }
  res.json({ ok: true });
});

app.put('/api/models/:id', auth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 id' });
  const name = String(req.body?.name ?? '').trim();
  const note = String(req.body?.note ?? '').trim();
  if (!name) return res.status(400).json({ error: '模型名不能为空' });
  if (name.length > 100) return res.status(400).json({ error: '模型名过长（最多 100 字）' });
  if (note.length > 500) return res.status(400).json({ error: '备注过长（最多 500 字）' });
  const row = db.prepare('SELECT * FROM models WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!row) return res.status(404).json({ error: '模型不存在' });
  const dup = db.prepare('SELECT id FROM models WHERE user_id = ? AND name = ? AND id != ?').get(req.userId, name, id);
  if (dup) return res.status(409).json({ error: '模型名已存在' });
  db.prepare('UPDATE models SET name = ?, note = ? WHERE id = ? AND user_id = ?').run(name, note, id, req.userId);
  res.json(rowToModel(db.prepare('SELECT * FROM models WHERE id = ?').get(id)));
});

app.delete('/api/models/:id', auth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 id' });
  const row = db.prepare('SELECT id FROM models WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!row) return res.status(404).json({ error: '模型不存在' });
  db.prepare('DELETE FROM models WHERE id = ? AND user_id = ?').run(id, req.userId);
  db.prepare('UPDATE prompts SET model_id = NULL, updated_at = datetime("now", "localtime") WHERE model_id = ? AND user_id = ?').run(id, req.userId);
  res.json({ ok: true });
});

// ---------- 来源 API（需要登录，维护用，编辑不改 id） ----------

app.get('/api/sources', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM sources WHERE user_id = ? ORDER BY sort_order ASC, id ASC').all(req.userId);
  res.json({ items: rows.map(rowToSource) });
});

app.post('/api/sources', auth, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const note = String(req.body?.note ?? '').trim();
  if (!name) return res.status(400).json({ error: '来源名不能为空' });
  if (name.length > 50) return res.status(400).json({ error: '来源名过长（最多 50 字）' });
  if (note.length > 500) return res.status(400).json({ error: '备注过长（最多 500 字）' });
  const existing = db.prepare('SELECT id FROM sources WHERE user_id = ? AND name = ?').get(req.userId, name);
  if (existing) return res.status(409).json({ error: '来源已存在', id: existing.id });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM sources WHERE user_id = ?').get(req.userId).m;
  const { lastInsertRowid } = db.prepare('INSERT INTO sources (user_id, name, note, sort_order) VALUES (?, ?, ?, ?)').run(req.userId, name, note, maxOrder + 1);
  res.status(201).json(rowToSource(db.prepare('SELECT * FROM sources WHERE id = ?').get(Number(lastInsertRowid))));
});

app.put('/api/sources/reorder', auth, (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须是数组' });
  const update = db.prepare('UPDATE sources SET sort_order = ? WHERE id = ? AND user_id = ?');
  const check = db.prepare('SELECT id FROM sources WHERE id = ? AND user_id = ?');
  for (let i = 0; i < ids.length; i++) {
    const id = Number(ids[i]);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: `无效的 id：${ids[i]}` });
    if (!check.get(id, req.userId)) return res.status(404).json({ error: `来源不存在：${id}` });
    update.run(i, id, req.userId);
  }
  res.json({ ok: true });
});

app.put('/api/sources/:id', auth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 id' });
  const name = String(req.body?.name ?? '').trim();
  const note = String(req.body?.note ?? '').trim();
  if (!name) return res.status(400).json({ error: '来源名不能为空' });
  if (name.length > 50) return res.status(400).json({ error: '来源名过长（最多 50 字）' });
  if (note.length > 500) return res.status(400).json({ error: '备注过长（最多 500 字）' });
  const row = db.prepare('SELECT * FROM sources WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!row) return res.status(404).json({ error: '来源不存在' });
  const dup = db.prepare('SELECT id FROM sources WHERE user_id = ? AND name = ? AND id != ?').get(req.userId, name, id);
  if (dup) return res.status(409).json({ error: '来源名已存在' });
  // 编辑只改 name 和 note，不改 id（关联的 prompts 不受影响）
  db.prepare('UPDATE sources SET name = ?, note = ? WHERE id = ? AND user_id = ?').run(name, note, id, req.userId);
  res.json(rowToSource(db.prepare('SELECT * FROM sources WHERE id = ?').get(id)));
});

app.delete('/api/sources/:id', auth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 id' });
  const row = db.prepare('SELECT id FROM sources WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!row) return res.status(404).json({ error: '来源不存在' });
  db.prepare('DELETE FROM sources WHERE id = ? AND user_id = ?').run(id, req.userId);
  // 引用该来源的 prompts 置空 source_id
  db.prepare('UPDATE prompts SET source_id = NULL, updated_at = datetime("now", "localtime") WHERE source_id = ? AND user_id = ?').run(id, req.userId);
  res.json({ ok: true });
});

// ---------- 模型资源 API（需要登录） ----------

app.get('/api/model-refs', auth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM model_refs WHERE user_id = ? ORDER BY download_name ASC, id ASC')
    .all(req.userId);
  res.json({ items: rows.map(rowToModelRef) });
});

app.post('/api/model-refs', auth, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const refType = String(req.body?.ref_type ?? 'lora');
  const modelIds = req.body?.model_ids;
  const url = String(req.body?.url ?? '').trim();
  const size = String(req.body?.size ?? '').trim();
  const downloadName = String(req.body?.download_name ?? '').trim();
  const note = String(req.body?.note ?? '').trim();
  if (!name) return res.status(400).json({ error: '名称不能为空' });
  if (name.length > 100) return res.status(400).json({ error: '名称过长（最多 100 字）' });
  if (!REF_TYPES.includes(refType)) return res.status(400).json({ error: '类型必须是 lora / checkpoint' });
  if (url.length > 2000) return res.status(400).json({ error: '链接过长（最多 2000 字）' });
  if (size.length > 50) return res.status(400).json({ error: '大小过长（最多 50 字）' });
  if (!downloadName) return res.status(400).json({ error: '下载名称不能为空' });
  if (downloadName.length > 200) return res.status(400).json({ error: '下载名称过长（最多 200 字）' });
  if (note.length > 500) return res.status(400).json({ error: '备注过长（最多 500 字）' });
  // 校验 model_ids（必填）
  const validIds = [];
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    return res.status(400).json({ error: '请选择关联的模型' });
  }
  const check = db.prepare('SELECT id FROM models WHERE id = ? AND user_id = ?');
  for (const item of modelIds) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: `无效的模型 id：${item}` });
    if (!check.get(id, req.userId)) return res.status(400).json({ error: `模型不存在：${id}` });
    if (!validIds.includes(id)) validIds.push(id);
  }
  const existing = db.prepare('SELECT id FROM model_refs WHERE user_id = ? AND name = ?').get(req.userId, name);
  if (existing) return res.status(409).json({ error: '名称已存在', id: existing.id });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM model_refs WHERE user_id = ?').get(req.userId).m;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO model_refs (user_id, name, ref_type, model_ids, url, size, download_name, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.userId, name, refType, JSON.stringify(validIds), url, size, downloadName, note, maxOrder + 1);
  res.status(201).json(rowToModelRef(db.prepare('SELECT * FROM model_refs WHERE id = ?').get(Number(lastInsertRowid))));
});

// 模型资源排序（注意：必须注册在 /api/model-refs/:id 之前，否则 reorder 会被 :id 路由抢占）
app.put('/api/model-refs/reorder', auth, (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须是数组' });
  const update = db.prepare('UPDATE model_refs SET sort_order = ? WHERE id = ? AND user_id = ?');
  const check = db.prepare('SELECT id FROM model_refs WHERE id = ? AND user_id = ?');
  for (let i = 0; i < ids.length; i++) {
    const id = Number(ids[i]);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: `无效的 id：${ids[i]}` });
    if (!check.get(id, req.userId)) return res.status(404).json({ error: `模型资源不存在：${id}` });
    update.run(i, id, req.userId);
  }
  res.json({ ok: true });
});

app.put('/api/model-refs/:id', auth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 id' });
  const name = String(req.body?.name ?? '').trim();
  const refType = String(req.body?.ref_type ?? 'lora');
  const modelIds = req.body?.model_ids;
  const url = String(req.body?.url ?? '').trim();
  const size = String(req.body?.size ?? '').trim();
  const downloadName = String(req.body?.download_name ?? '').trim();
  const note = String(req.body?.note ?? '').trim();
  if (!name) return res.status(400).json({ error: '名称不能为空' });
  if (name.length > 100) return res.status(400).json({ error: '名称过长（最多 100 字）' });
  if (!REF_TYPES.includes(refType)) return res.status(400).json({ error: '类型必须是 lora / checkpoint' });
  if (url.length > 2000) return res.status(400).json({ error: '链接过长（最多 2000 字）' });
  if (size.length > 50) return res.status(400).json({ error: '大小过长（最多 50 字）' });
  if (!downloadName) return res.status(400).json({ error: '下载名称不能为空' });
  if (downloadName.length > 200) return res.status(400).json({ error: '下载名称过长（最多 200 字）' });
  if (note.length > 500) return res.status(400).json({ error: '备注过长（最多 500 字）' });
  const row = db.prepare('SELECT * FROM model_refs WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!row) return res.status(404).json({ error: '模型资源不存在' });
  const dup = db.prepare('SELECT id FROM model_refs WHERE user_id = ? AND name = ? AND id != ?').get(req.userId, name, id);
  if (dup) return res.status(409).json({ error: '名称已存在' });
  // 校验 model_ids（必填）
  const validIds = [];
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    return res.status(400).json({ error: '请选择关联的模型' });
  }
  const check = db.prepare('SELECT id FROM models WHERE id = ? AND user_id = ?');
  for (const item of modelIds) {
    const mid = Number(item);
    if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: `无效的模型 id：${item}` });
    if (!check.get(mid, req.userId)) return res.status(400).json({ error: `模型不存在：${mid}` });
    if (!validIds.includes(mid)) validIds.push(mid);
  }
  db.prepare('UPDATE model_refs SET name = ?, ref_type = ?, model_ids = ?, url = ?, size = ?, download_name = ?, note = ? WHERE id = ? AND user_id = ?').run(name, refType, JSON.stringify(validIds), url, size, downloadName, note, id, req.userId);
  res.json(rowToModelRef(db.prepare('SELECT * FROM model_refs WHERE id = ?').get(id)));
});

app.delete('/api/model-refs/:id', auth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 id' });
  const row = db.prepare('SELECT id FROM model_refs WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!row) return res.status(404).json({ error: '模型资源不存在' });
  db.prepare('DELETE FROM model_refs WHERE id = ? AND user_id = ?').run(id, req.userId);
  // 从当前用户的 prompts 中移除该 model_ref id
  const prompts = db.prepare('SELECT id, model_refs FROM prompts WHERE user_id = ?').all(req.userId);
  const update = db.prepare('UPDATE prompts SET model_refs = ?, updated_at = datetime("now", "localtime") WHERE id = ? AND user_id = ?');
  for (const p of prompts) {
    const ids = JSON.parse(p.model_refs || '[]').filter((t) => t !== id);
    update.run(JSON.stringify(ids), p.id, req.userId);
  }
  res.json({ ok: true });
});

// ---------- 提示词 API（需要登录） ----------

app.get('/api/prompts', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM prompts WHERE user_id = ? ORDER BY id DESC').all(req.userId);
  res.json({ items: rows.map(rowToPrompt) });
});

app.post('/api/prompts', auth, (req, res) => {
  const parsed = parseBody(req.userId, req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO prompts (user_id, title, content, type, tags, model_id, model_refs, source_id, url, note, favorite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.userId, parsed.data.title, parsed.data.content, parsed.data.type, parsed.data.tags, parsed.data.model_id, parsed.data.model_refs, parsed.data.source_id, parsed.data.url, parsed.data.note, parsed.data.favorite);
  res.status(201).json(getPrompt(req.userId, Number(lastInsertRowid)));
});

app.put('/api/prompts/:id', auth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 id' });
  if (!getPrompt(req.userId, id)) return res.status(404).json({ error: '提示词不存在' });
  const parsed = parseBody(req.userId, req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  db.prepare(
    `UPDATE prompts
        SET title = ?, content = ?, type = ?, tags = ?, model_id = ?, model_refs = ?, source_id = ?, url = ?, note = ?, favorite = ?,
            updated_at = datetime('now', 'localtime')
      WHERE id = ? AND user_id = ?`
  ).run(parsed.data.title, parsed.data.content, parsed.data.type, parsed.data.tags, parsed.data.model_id, parsed.data.model_refs, parsed.data.source_id, parsed.data.url, parsed.data.note, parsed.data.favorite, id, req.userId);
  res.json(getPrompt(req.userId, id));
});

app.patch('/api/prompts/:id/favorite', auth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 id' });
  if (!getPrompt(req.userId, id)) return res.status(404).json({ error: '提示词不存在' });
  db.prepare(
    `UPDATE prompts SET favorite = 1 - favorite, updated_at = datetime('now', 'localtime') WHERE id = ? AND user_id = ?`
  ).run(id, req.userId);
  res.json(getPrompt(req.userId, id));
});

app.delete('/api/prompts/:id', auth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 id' });
  const { changes } = db.prepare('DELETE FROM prompts WHERE id = ? AND user_id = ?').run(id, req.userId);
  if (!changes) return res.status(404).json({ error: '提示词不存在' });
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

// ---------- 生产模式：托管前端静态文件 ----------

if (isProd) {
  const distDir = path.join(__dirname, 'dist');
  if (!existsSync(path.join(distDir, 'index.html'))) {
    console.warn('[call-word] 未找到 dist/，请先执行 npm run build');
  }
  app.use(express.static(distDir));
  // SPA 回退：非 /api 的 GET 请求一律返回 index.html
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(path.join(distDir, 'index.html'));
    } else {
      next();
    }
  });
}

// ---------- 错误处理 ----------

app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体不是合法的 JSON' });
  }
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

// 生产模式默认 80 端口，开发模式 3000 端口，可用环境变量 PORT 覆盖
const PORT = Number(process.env.PORT) || (isProd ? 80 : 3000);
app.listen(PORT, () => {
  console.log(`[call-word] ${isProd ? '生产' : '开发'}模式已启动: http://localhost:${PORT}`);
  if (isProd) console.log('[call-word] 正在托管 dist/ 前端静态文件');
});
