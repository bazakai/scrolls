import type Database from "better-sqlite3";
export interface IndexResult {
    chunksAdded: number;
    bytesRead: number;
}
export declare function indexFile({ db, path, }: {
    db: Database.Database;
    path: string;
}): Promise<IndexResult>;
//# sourceMappingURL=indexer.d.ts.map