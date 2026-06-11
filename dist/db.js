import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync, existsSync } from "fs";
import { SESSION_MEMORY_DIR, DB_PATH, EMBEDDING_DIMS } from "./config.js";
export { SESSION_MEMORY_DIR, DB_PATH };
export function ensureDir() {
    if (!existsSync(SESSION_MEMORY_DIR)) {
        mkdirSync(SESSION_MEMORY_DIR, { recursive: true });
    }
}
export function openDb(readonly = false) {
    ensureDir();
    const db = new Database(DB_PATH, { readonly });
    sqliteVec.load(db);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    return db;
}
export function initSchema(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      mtime INTEGER NOT NULL DEFAULT 0,
      last_indexed_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL,
      session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      cwd TEXT NOT NULL,
      ts TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      seq INTEGER NOT NULL,
      is_sidechain INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_session_seq ON chunks(session_id, seq);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_uuid_seq ON chunks(uuid, seq);
    CREATE INDEX IF NOT EXISTS idx_chunks_uuid ON chunks(uuid);
    CREATE INDEX IF NOT EXISTS idx_chunks_project ON chunks(project);
    CREATE INDEX IF NOT EXISTS idx_chunks_ts ON chunks(ts);

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text,
      content='chunks',
      content_rowid='id',
      tokenize='porter ascii'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      embedding float[${EMBEDDING_DIMS}]
    );

    CREATE TABLE IF NOT EXISTS stats (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
    // Migrate pre-1.0 databases; rows keep defaults until a reindex.
    const chunkCols = db.prepare("PRAGMA table_info(chunks)").all().map((c) => c.name);
    if (!chunkCols.includes("is_sidechain")) {
        db.exec("ALTER TABLE chunks ADD COLUMN is_sidechain INTEGER NOT NULL DEFAULT 0");
    }
    if (!chunkCols.includes("source")) {
        db.exec("ALTER TABLE chunks ADD COLUMN source TEXT NOT NULL DEFAULT ''");
    }
}
//# sourceMappingURL=db.js.map