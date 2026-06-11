import { readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import type Database from "better-sqlite3";
import { PROJECTS_DIR } from "./config.js";
import { indexFile } from "./indexer.js";

interface BackfillOptions {
  projectsDir?: string;
  project?: string;
  limit?: number;
  log: (msg: string) => void;
}

interface BackfillResult {
  filesProcessed: number;
  chunksAdded: number;
  durationMs: number;
  errors: number;
}

function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(full);
    }
  }
  return results;
}

export async function backfill({
  db,
  options,
}: {
  db: Database.Database;
  options: BackfillOptions;
}): Promise<BackfillResult> {
  const { log, limit } = options;
  const projectsDir = options.projectsDir ?? PROJECTS_DIR;

  let dirs: string[];
  if (options.project) {
    dirs = [join(projectsDir, options.project)];
  } else {
    if (!existsSync(projectsDir)) {
      log(`projects dir not found: ${projectsDir}`);
      return { filesProcessed: 0, chunksAdded: 0, durationMs: 0, errors: 0 };
    }
    dirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(projectsDir, e.name));
  }

  const allFiles: string[] = [];
  for (const dir of dirs) {
    allFiles.push(...findJsonlFiles(dir));
  }

  const files = limit !== undefined ? allFiles.slice(0, limit) : allFiles;
  log(`backfill: found ${allFiles.length} files, processing ${files.length}`);

  const start = Date.now();
  let chunksAdded = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    const path = files[i];
    try {
      const stat = statSync(path);
      const existing = db
        .prepare<
          [string],
          { byte_offset: number; mtime: number }
        >("SELECT byte_offset, mtime FROM files WHERE path = ?")
        .get(path);

      if (
        existing &&
        existing.byte_offset >= stat.size &&
        existing.mtime === Math.floor(stat.mtimeMs)
      ) {
        continue;
      }

      const result = await indexFile({ db, path });
      chunksAdded += result.chunksAdded;

      if ((i + 1) % 50 === 0) {
        log(
          `backfill progress: ${i + 1}/${files.length}, chunks so far: ${chunksAdded}`,
        );
      }
    } catch (err) {
      errors++;
      log(`backfill error ${path}: ${String(err)}`);
    }
  }

  const durationMs = Date.now() - start;
  log(
    `backfill complete: ${files.length} files, ${chunksAdded} chunks, ${errors} errors, ${durationMs}ms`,
  );

  return { filesProcessed: files.length, chunksAdded, durationMs, errors };
}
