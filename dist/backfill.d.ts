import type Database from "better-sqlite3";
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
export declare function backfill({ db, options, }: {
    db: Database.Database;
    options: BackfillOptions;
}): Promise<BackfillResult>;
export {};
//# sourceMappingURL=backfill.d.ts.map