import type Database from "better-sqlite3";
import { type IndexResult } from "./indexer.js";
type LogFn = (msg: string) => void;
export declare class IndexQueue {
    private pending;
    private running;
    private ready;
    private db;
    private log;
    private errorCount;
    private lastIndexTime;
    private totalChunks;
    constructor({ db, log }: {
        db: Database.Database;
        log: LogFn;
    });
    enqueue(path: string): void;
    get depth(): number;
    get stats(): {
        errorCount: number;
        lastIndexTime: number | null;
        totalChunks: number;
    };
    indexNow(path: string): Promise<IndexResult>;
    private runIndex;
    private drain;
}
export {};
//# sourceMappingURL=queue.d.ts.map