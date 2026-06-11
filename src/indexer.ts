import { openSync, readSync, fstatSync, closeSync } from "fs";
import { basename } from "path";
import type Database from "better-sqlite3";
import { parseLine, projectFromPath, type ParsedChunk } from "./parser.js";
import { embedBatch } from "./embedder.js";

interface FileRow {
  byte_offset: number;
}

export interface IndexResult {
  chunksAdded: number;
  bytesRead: number;
}

function readNewLines({ path, offset }: { path: string; offset: number }): {
  lines: string[];
  newOffset: number;
  mtime: number;
} {
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    const mtime = Math.floor(stat.mtimeMs);
    const fileSize = stat.size;

    if (fileSize < offset) {
      return { lines: [], newOffset: 0, mtime };
    }
    if (fileSize === offset) {
      return { lines: [], newOffset: offset, mtime };
    }

    const toRead = fileSize - offset;
    const buf = Buffer.allocUnsafe(toRead);
    readSync(fd, buf, 0, toRead, offset);
    const raw = buf.toString("utf8");

    const lastNewline = raw.lastIndexOf("\n");
    if (lastNewline === -1) {
      return { lines: [], newOffset: offset, mtime };
    }

    const complete = raw.slice(0, lastNewline);
    const lines = complete.split("\n").filter((l) => l.trim().length > 0);
    const newOffset = offset + Buffer.byteLength(complete, "utf8") + 1;

    return { lines, newOffset, mtime };
  } finally {
    closeSync(fd);
  }
}

function getNextSeq({
  db,
  sessionId,
}: {
  db: Database.Database;
  sessionId: string;
}): number {
  const row = db
    .prepare<
      [string],
      { max_seq: number | null }
    >("SELECT MAX(seq) as max_seq FROM chunks WHERE session_id = ?")
    .get(sessionId);
  return (row?.max_seq ?? -1) + 1;
}

function deleteChunksByFile({
  db,
  fileStem,
}: {
  db: Database.Database;
  fileStem: string;
}): void {
  // Pre-1.0 rows have source='' but their session_id matched the file name.
  const ids = db
    .prepare<[string, string], { id: number }>(
      "SELECT id FROM chunks WHERE source = ? OR (source = '' AND session_id = ?)",
    )
    .all(fileStem, fileStem)
    .map((r) => r.id);

  if (ids.length === 0) return;

  const ph = ids.map(() => "?").join(",");
  db.prepare(`DELETE FROM vec_chunks WHERE rowid IN (${ph})`).run(...ids);
  db.prepare(`DELETE FROM chunks_fts WHERE rowid IN (${ph})`).run(...ids);
  db.prepare(`DELETE FROM chunks WHERE id IN (${ph})`).run(...ids);
}

async function runIndexFile({
  db,
  path,
}: {
  db: Database.Database;
  path: string;
}): Promise<IndexResult> {
  const existing = db
    .prepare("SELECT byte_offset FROM files WHERE path = ?")
    .get(path) as FileRow | undefined;

  const startOffset = existing?.byte_offset ?? 0;
  const { lines, newOffset, mtime } = readNewLines({
    path,
    offset: startOffset,
  });

  // File was truncated/rotated — reset from zero
  if (newOffset === 0 && startOffset > 0) {
    deleteChunksByFile({ db, fileStem: basename(path, ".jsonl") });
    db.prepare("DELETE FROM files WHERE path = ?").run(path);
    return runIndexFile({ db, path });
  }

  if (lines.length === 0) {
    db.prepare(
      "INSERT OR IGNORE INTO files (path, byte_offset, mtime, last_indexed_at) VALUES (?, ?, ?, ?)",
    ).run(path, newOffset, mtime, Date.now());
    return { chunksAdded: 0, bytesRead: 0 };
  }

  const project = projectFromPath(path);
  const allChunks: ParsedChunk[] = [];
  for (const line of lines) {
    for (const chunk of parseLine(line)) {
      allChunks.push(chunk);
    }
  }

  if (allChunks.length === 0) {
    db.prepare(
      "INSERT OR REPLACE INTO files (path, byte_offset, mtime, last_indexed_at) VALUES (?, ?, ?, ?)",
    ).run(path, newOffset, mtime, Date.now());
    return { chunksAdded: 0, bytesRead: newOffset - startOffset };
  }

  const embeddings = await embedBatch(allChunks.map((c) => c.text));

  const source = basename(path, ".jsonl");
  const insertChunk = db.prepare(
    "INSERT OR IGNORE INTO chunks (uuid, session_id, project, cwd, ts, kind, text, seq, is_sidechain, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  // sqlite-vec 0.1.x: rowid auto-assigned; must match chunks.id so we re-insert with explicit rowid via SQL.
  // Only valid right after a successful chunk insert (changes === 1) — an ignored insert leaves
  // last_insert_rowid() pointing at a previous row.
  const insertVec = db.prepare(
    "INSERT INTO vec_chunks(rowid, embedding) VALUES (last_insert_rowid(), ?)",
  );
  const insertFts = db.prepare(
    "INSERT INTO chunks_fts(rowid, text) VALUES (last_insert_rowid(), ?)",
  );
  const seqCache = new Map<string, number>();

  const insertAll = db.transaction((): number => {
    // Optimistic concurrency: another writer (other process, or an interleaved call
    // that slipped past single-flight) may have advanced the offset while we were
    // embedding. Re-check inside the write transaction and bail if so — otherwise
    // we would re-insert the same range under freshly computed (higher) seqs that
    // the UNIQUE(uuid, seq) constraint cannot catch.
    const current = db
      .prepare("SELECT byte_offset FROM files WHERE path = ?")
      .get(path) as FileRow | undefined;
    if ((current?.byte_offset ?? 0) !== startOffset) return 0;

    let inserted = 0;
    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i];

      if (!seqCache.has(chunk.sessionId)) {
        seqCache.set(
          chunk.sessionId,
          getNextSeq({ db, sessionId: chunk.sessionId }),
        );
      }
      const seq = seqCache.get(chunk.sessionId)!;
      seqCache.set(chunk.sessionId, seq + 1);

      const { changes } = insertChunk.run(
        chunk.uuid,
        chunk.sessionId,
        project,
        chunk.cwd,
        chunk.ts,
        chunk.kind,
        chunk.text,
        seq,
        chunk.isSidechain ? 1 : 0,
        source,
      );

      if (changes === 1) {
        insertVec.run(embeddings[i]);
        insertFts.run(chunk.text);
        inserted++;
      }
    }

    db.prepare(
      "INSERT OR REPLACE INTO files (path, byte_offset, mtime, last_indexed_at) VALUES (?, ?, ?, ?)",
    ).run(path, newOffset, mtime, Date.now());

    return inserted;
  });

  // BEGIN IMMEDIATE: a deferred transaction would pin a read snapshot at the
  // offset re-check and fail with SQLITE_BUSY_SNAPSHOT on write upgrade whenever
  // another process (backfill CLI vs daemon) committed in between.
  const chunksAdded = insertAll.immediate();
  if (chunksAdded === 0 && allChunks.length > 0) {
    return { chunksAdded: 0, bytesRead: 0 };
  }

  return { chunksAdded, bytesRead: newOffset - startOffset };
}

const inFlight = new Map<string, Promise<IndexResult>>();

export function indexFile({
  db,
  path,
}: {
  db: Database.Database;
  path: string;
}): Promise<IndexResult> {
  // Single-flight per path: concurrent callers (ingest queue, backfill) are chained
  // so only one indexing pass per path runs at a time within this process.
  const prev = inFlight.get(path) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => runIndexFile({ db, path }));
  inFlight.set(path, run);
  run.finally(() => {
    if (inFlight.get(path) === run) inFlight.delete(path);
  });
  return run;
}
