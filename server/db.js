import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const db = new DatabaseSync(path.join(__dirname, 'call-word.db'));

// 用户表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    password_salt TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  )
`);

// 会话表（token 登录）
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// 标签表（加 user_id + sort_order）
db.exec(`
  CREATE TABLE IF NOT EXISTS tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (user_id, name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// 模型表（加 user_id + sort_order + note）
db.exec(`
  CREATE TABLE IF NOT EXISTS models (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT    NOT NULL,
    note       TEXT    NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (user_id, name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// 来源表（user_id + name + note，维护用，编辑不改 id）
db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT    NOT NULL,
    note       TEXT    NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (user_id, name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// 模型资源表（name + type + note + 关联的 model ids + url 链接 + size + download_name）
db.exec(`
  CREATE TABLE IF NOT EXISTS model_refs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    name          TEXT    NOT NULL,
    ref_type      TEXT    NOT NULL DEFAULT 'lora' CHECK (ref_type IN ('lora', 'checkpoint')),
    model_ids     TEXT    NOT NULL DEFAULT '[]',
    url           TEXT    NOT NULL DEFAULT '',
    size          TEXT    NOT NULL DEFAULT '',
    download_name TEXT    NOT NULL DEFAULT '',
    note          TEXT    NOT NULL DEFAULT '',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (user_id, name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// 提示词表（加 user_id + model_refs）
db.exec(`
  CREATE TABLE IF NOT EXISTS prompts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    title      TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    type       TEXT    NOT NULL CHECK (type IN ('t2i', 't2v', 'i2v')),
    tags       TEXT    NOT NULL DEFAULT '[]',
    model_id   INTEGER,
    model_refs TEXT    NOT NULL DEFAULT '[]',
    source     TEXT    NOT NULL DEFAULT 'self' CHECK (source IN ('civitai', 'self', 'liblib')),
    url        TEXT    NOT NULL DEFAULT '',
    note       TEXT    NOT NULL DEFAULT '',
    favorite   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// 兼容旧库：若 prompts 缺少 user_id / model_id / source / url 列则补上
try {
  db.prepare('SELECT user_id FROM prompts LIMIT 1').get();
} catch {
  db.exec(`ALTER TABLE prompts ADD COLUMN user_id INTEGER`);
}
try {
  db.prepare('SELECT model_id FROM prompts LIMIT 1').get();
} catch {
  db.exec(`ALTER TABLE prompts ADD COLUMN model_id INTEGER`);
}
try {
  db.prepare('SELECT source FROM prompts LIMIT 1').get();
} catch {
  db.exec(`ALTER TABLE prompts ADD COLUMN source TEXT NOT NULL DEFAULT 'self' CHECK (source IN ('civitai', 'self', 'liblib'))`);
}
try {
  db.prepare('SELECT url FROM prompts LIMIT 1').get();
} catch {
  db.exec(`ALTER TABLE prompts ADD COLUMN url TEXT NOT NULL DEFAULT ''`);
}
try {
  db.prepare('SELECT model_refs FROM prompts LIMIT 1').get();
} catch {
  db.exec(`ALTER TABLE prompts ADD COLUMN model_refs TEXT NOT NULL DEFAULT '[]'`);
}

// 兼容旧库：prompts 加 source_id 列（来源改为维护，按 id 关联，编辑不改 id）
try {
  db.prepare('SELECT source_id FROM prompts LIMIT 1').get();
} catch {
  db.exec(`ALTER TABLE prompts ADD COLUMN source_id INTEGER`);
}
// 迁移：把旧 source 文本转换成 sources 表的 id
{
  const pending = db.prepare('SELECT COUNT(*) AS c FROM prompts WHERE source_id IS NULL').get();
  if (pending.c > 0) {
    db.exec(`
      INSERT INTO sources (user_id, name, sort_order)
      SELECT DISTINCT p.user_id, p.source, 0
      FROM prompts p
      WHERE p.source IS NOT NULL AND p.source != ''
        AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.user_id = p.user_id AND s.name = p.source);
    `);
    db.exec(`
      UPDATE prompts
      SET source_id = (
        SELECT s.id FROM sources s
        WHERE s.user_id = prompts.user_id AND s.name = prompts.source
      )
      WHERE source_id IS NULL;
    `);
  }
}

// 兼容旧库：model_refs 缺少 url 列则补上
try {
  db.prepare('SELECT url FROM model_refs LIMIT 1').get();
} catch {
  db.exec(`ALTER TABLE model_refs ADD COLUMN url TEXT NOT NULL DEFAULT ''`);
}

// 兼容旧库：prompts 的 source CHECK 不含 liblib 则重建表
{
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='prompts'").get();
  if (row && row.sql && !/liblib/.test(row.sql)) {
    db.exec(`
      CREATE TABLE prompts_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        title      TEXT    NOT NULL,
        content    TEXT    NOT NULL,
        type       TEXT    NOT NULL CHECK (type IN ('t2i', 't2v', 'i2v')),
        tags       TEXT    NOT NULL DEFAULT '[]',
        model_id   INTEGER,
        model_refs TEXT    NOT NULL DEFAULT '[]',
        source     TEXT    NOT NULL DEFAULT 'self' CHECK (source IN ('civitai', 'self', 'liblib')),
        url        TEXT    NOT NULL DEFAULT '',
        note       TEXT    NOT NULL DEFAULT '',
        favorite   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO prompts_new (id, user_id, title, content, type, tags, model_id, model_refs, source, url, note, favorite, created_at, updated_at)
        SELECT id, user_id, title, content, type, tags, model_id, model_refs, source, url, note, favorite, created_at, updated_at FROM prompts;
      DROP TABLE prompts;
      ALTER TABLE prompts_new RENAME TO prompts;
    `);
  }
}
// 兼容旧库：model_refs 缺少 size / download_name 列则补上
try {
  db.prepare('SELECT size FROM model_refs LIMIT 1').get();
} catch {
  db.exec(`ALTER TABLE model_refs ADD COLUMN size TEXT NOT NULL DEFAULT ''`);
}
try {
  db.prepare('SELECT download_name FROM model_refs LIMIT 1').get();
} catch {
  db.exec(`ALTER TABLE model_refs ADD COLUMN download_name TEXT NOT NULL DEFAULT ''`);
}

// 兼容旧库：tags/models 缺少 sort_order 列则补上
try {
  db.prepare('SELECT sort_order FROM tags LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE tags ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
}
try {
  db.prepare('SELECT sort_order FROM models LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE models ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
}

// 兼容旧库：models / sources / model_refs 缺少 note 列则补上
try {
  db.prepare('SELECT note FROM models LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE models ADD COLUMN note TEXT NOT NULL DEFAULT ''");
}
try {
  db.prepare('SELECT note FROM sources LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE sources ADD COLUMN note TEXT NOT NULL DEFAULT ''");
}
try {
  db.prepare('SELECT note FROM model_refs LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE model_refs ADD COLUMN note TEXT NOT NULL DEFAULT ''");
}

/** 把数据库行转换为接口返回的对象，tags 和 model_refs 存的是 id 数组 */
export function rowToPrompt(row) {
  if (!row) return null;
  return {
    ...row,
    favorite: !!row.favorite,
    tags: JSON.parse(row.tags || '[]'),
    model_refs: JSON.parse(row.model_refs || '[]'),
  };
}

/** 把 tag 行转换为接口返回的对象 */
export function rowToTag(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, sort_order: row.sort_order ?? 0, created_at: row.created_at };
}

/** 把 model 行转换为接口返回的对象 */
export function rowToModel(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, note: row.note ?? '', sort_order: row.sort_order ?? 0, created_at: row.created_at };
}

/** 把 source 行转换为接口返回的对象 */
export function rowToSource(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, note: row.note ?? '', sort_order: row.sort_order ?? 0, created_at: row.created_at };
}

/** 把 model_ref 行转换为接口返回的对象，model_ids 存的是 id 数组 */
export function rowToModelRef(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    ref_type: row.ref_type,
    model_ids: JSON.parse(row.model_ids || '[]'),
    url: row.url ?? '',
    size: row.size ?? '',
    download_name: row.download_name ?? '',
    note: row.note ?? '',
    sort_order: row.sort_order ?? 0,
    created_at: row.created_at,
  };
}

/** 把 user 行转换为接口返回的对象（不包含密码） */
export function rowToUser(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, created_at: row.created_at };
}
