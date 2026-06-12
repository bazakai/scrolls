import { join } from "path";
import { homedir } from "os";
function env(name) {
    const value = process.env[name];
    return value && value.trim() ? value : undefined;
}
export const SESSION_MEMORY_DIR = env("SCROLLS_DIR") ?? join(homedir(), ".claude", "scrolls");
export const DB_PATH = join(SESSION_MEMORY_DIR, "index.db");
export const DAEMON_PORT = Number(env("SCROLLS_PORT") ?? 48642);
export const PROJECTS_DIR = env("SCROLLS_PROJECTS_DIR") ?? join(homedir(), ".claude", "projects");
export const MODEL_ID = env("SCROLLS_MODEL") ?? "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMS = Number(env("SCROLLS_DIMS") ?? 384);
// Cosine distance above which a KNN hit is considered noise. Measured on a
// 149k-chunk index: on-topic results sit at 0.80-1.11, garbage at 1.15+.
export const RELEVANCE_FLOOR = Number(env("SCROLLS_RELEVANCE_FLOOR") ?? 1.15);
export const CANDIDATE_LIMIT = Number(env("SCROLLS_CANDIDATE_LIMIT") ?? 40);
export const RRF_K = Number(env("SCROLLS_RRF_K") ?? 60);
