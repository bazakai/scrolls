import Database from "better-sqlite3";
import { SESSION_MEMORY_DIR, DB_PATH } from "./config.js";
export { SESSION_MEMORY_DIR, DB_PATH };
export declare function ensureDir(): void;
export declare function openDb(readonly?: boolean): Database.Database;
export declare function initSchema(db: Database.Database): void;
//# sourceMappingURL=db.d.ts.map