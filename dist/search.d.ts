import type Database from "better-sqlite3";
export interface SearchFilters {
    project?: string;
    kind?: string;
    after?: string;
    before?: string;
    exact?: string;
}
export type MatchType = "semantic" | "keyword" | "both";
export type SearchOrder = "relevance" | "recent";
export interface SearchHit {
    rank: number;
    matchType: MatchType;
    timestamp: string;
    sessionId: string;
    project: string;
    cwd: string;
    kind: string;
    text: string;
    uuid: string;
}
export interface WindowChunk {
    seq: number;
    kind: string;
    timestamp: string;
    text: string;
}
export declare function hybridSearch({ db, query, filters, limit, order, }: {
    db: Database.Database;
    query: string;
    filters?: SearchFilters;
    limit?: number;
    order?: SearchOrder;
}): Promise<SearchHit[]>;
export declare function getSessionWindow({ db, sessionId, uuid, timestamp, radius, }: {
    db: Database.Database;
    sessionId: string;
    uuid?: string;
    timestamp?: string;
    radius?: number;
}): WindowChunk[];
//# sourceMappingURL=search.d.ts.map