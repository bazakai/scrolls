import type Database from "better-sqlite3";
import { indexFile, type IndexResult } from "./indexer.js";

interface QueueEntry {
  path: string;
  timer: ReturnType<typeof setTimeout>;
}

type LogFn = (msg: string) => void;

export class IndexQueue {
  private pending = new Map<string, QueueEntry>();
  private running = false;
  private ready: Array<string> = [];
  private db: Database.Database;
  private log: LogFn;
  private errorCount = 0;
  private lastIndexTime: number | null = null;
  private totalChunks = 0;

  constructor({ db, log }: { db: Database.Database; log: LogFn }) {
    this.db = db;
    this.log = log;
  }

  enqueue(path: string): void {
    const existing = this.pending.get(path);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      this.pending.delete(path);
      this.ready.push(path);
      this.drain();
    }, 1500);

    this.pending.set(path, { path, timer });
  }

  get depth(): number {
    return this.pending.size + this.ready.length;
  }

  get stats(): {
    errorCount: number;
    lastIndexTime: number | null;
    totalChunks: number;
  } {
    return {
      errorCount: this.errorCount,
      lastIndexTime: this.lastIndexTime,
      totalChunks: this.totalChunks,
    };
  }

  async indexNow(path: string): Promise<IndexResult> {
    const existing = this.pending.get(path);
    if (existing) {
      clearTimeout(existing.timer);
      this.pending.delete(path);
    }

    return this.runIndex(path);
  }

  private async runIndex(path: string): Promise<IndexResult> {
    try {
      const result = await indexFile({ db: this.db, path });
      this.lastIndexTime = Date.now();
      this.totalChunks += result.chunksAdded;
      if (result.chunksAdded > 0) {
        this.log(`indexed ${path}: +${result.chunksAdded} chunks`);
      }
      return result;
    } catch (err) {
      this.errorCount++;
      this.log(`error indexing ${path}: ${String(err)}`);
      return { chunksAdded: 0, bytesRead: 0 };
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.ready.length > 0) {
      const path = this.ready.shift()!;
      await this.runIndex(path);
    }

    this.running = false;
  }
}
