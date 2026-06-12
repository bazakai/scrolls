import { createServer } from "http";
import { createWriteStream, writeFileSync, realpathSync, existsSync, } from "fs";
import { join, sep } from "path";
import { fileURLToPath } from "url";
import { openDb, initSchema, SESSION_MEMORY_DIR } from "./db.js";
import { DAEMON_PORT, PROJECTS_DIR } from "./config.js";
import { IndexQueue } from "./queue.js";
import { backfill } from "./backfill.js";
import { preloadModel, getModelState } from "./embedder.js";
import { z } from "zod";
const PORT = DAEMON_PORT;
const HOST = "127.0.0.1";
const PID_FILE = join(SESSION_MEMORY_DIR, "daemon.pid");
const LOG_FILE = join(SESSION_MEMORY_DIR, "daemon.log");
function openLog() {
    return createWriteStream(LOG_FILE, { flags: "a" });
}
// Log file only — the daemon is launched with stderr redirected into the same
// file, so writing to both would double every line.
function log(msg) {
    logStream.write(`${new Date().toISOString()} ${msg}\n`);
}
const logStream = openLog();
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}
function json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
}
const IngestBody = z.object({
    transcript_path: z.string().optional(),
    session_id: z.string().optional(),
    cwd: z.string().optional(),
    hook_event_name: z.string().optional(),
});
const BackfillBody = z.object({
    projectsDir: z.string().optional(),
    project: z.string().optional(),
    limit: z.number().int().positive().optional(),
});
async function main() {
    const db = openDb();
    initSchema(db);
    const queue = new IndexQueue({ db, log });
    // Start model loading in background — don't block /health
    preloadModel().catch((err) => log(`model load error: ${err}`));
    const server = createServer(async (req, res) => {
        try {
            await handleRequest(req, res, queue, db);
        }
        catch (err) {
            log(`unhandled error: ${err}`);
            json(res, 500, { error: String(err) });
        }
    });
    server.listen(PORT, HOST, () => {
        log(`daemon listening on ${HOST}:${PORT}`);
        writeFileSync(PID_FILE, String(process.pid));
        // Catch-up sweep: hook events fired while the daemon was down were dropped
        // by ingest.sh, so transcript tails written during downtime are only ever
        // recovered here. Idempotent — unchanged files are skipped by offset/mtime.
        backfill({ db, options: { log } }).catch((err) => log(`startup backfill error: ${err}`));
    });
    // Uninstall awareness: when the install directory is deleted (plugin
    // uninstalled, checkout removed), shut down instead of running orphaned.
    const selfPath = fileURLToPath(import.meta.url);
    setInterval(() => {
        if (!existsSync(selfPath)) {
            log("install directory removed — shutting down (uninstall cleanup)");
            server.close();
            db.close();
            process.exit(0);
        }
    }, 60_000).unref();
    process.on("SIGTERM", () => {
        log("shutting down (SIGTERM)");
        server.close();
        db.close();
        process.exit(0);
    });
    process.on("SIGINT", () => {
        log("shutting down (SIGINT)");
        server.close();
        db.close();
        process.exit(0);
    });
}
let realProjectsDir = null;
function isAllowedTranscriptPath(path) {
    if (!path.endsWith(".jsonl"))
        return false;
    try {
        realProjectsDir ??= realpathSync(PROJECTS_DIR);
        return realpathSync(path).startsWith(realProjectsDir + sep);
    }
    catch {
        return false;
    }
}
async function handleRequest(req, res, queue, db) {
    const { method, url } = req;
    // Hooks are curl, not browsers — an Origin/Referer header means a web page
    // is poking the daemon cross-origin (CSRF / DNS rebinding). Reject outright.
    if (req.headers.origin || req.headers.referer) {
        json(res, 403, { error: "forbidden" });
        return;
    }
    if (method === "GET" && url === "/health") {
        json(res, 200, {
            ok: true,
            queueDepth: queue.depth,
            model: getModelState(),
        });
        return;
    }
    if (method === "GET" && url === "/stats") {
        const filesCount = db.prepare("SELECT COUNT(*) as n FROM files").get().n;
        const chunksCount = db.prepare("SELECT COUNT(*) as n FROM chunks").get().n;
        const ftsCount = db.prepare("SELECT COUNT(*) as n FROM chunks_fts").get().n;
        const vecCount = db.prepare("SELECT COUNT(*) as n FROM vec_chunks").get().n;
        const { errorCount, lastIndexTime } = queue.stats;
        json(res, 200, {
            filesTracked: filesCount,
            chunks: chunksCount,
            ftsRows: ftsCount,
            vecRows: vecCount,
            lastIndexTime,
            totalErrors: errorCount,
        });
        return;
    }
    if (method === "POST" && url === "/ingest") {
        res.writeHead(202).end();
        const raw = await readBody(req);
        try {
            const body = IngestBody.parse(JSON.parse(raw));
            if (body.transcript_path) {
                if (isAllowedTranscriptPath(body.transcript_path)) {
                    queue.enqueue(body.transcript_path);
                }
                else {
                    log(`ingest rejected path outside projects dir: ${body.transcript_path}`);
                }
            }
        }
        catch (err) {
            log(`ingest parse error: ${err}`);
        }
        return;
    }
    if (method === "POST" && url === "/backfill") {
        const raw = await readBody(req);
        let opts = {};
        try {
            opts = BackfillBody.parse(JSON.parse(raw));
        }
        catch {
            // use defaults
        }
        json(res, 202, { started: true });
        backfill({ db, options: { ...opts, log } }).catch((err) => log(`backfill error: ${err}`));
        return;
    }
    json(res, 404, { error: "not found" });
}
main().catch((err) => {
    process.stderr.write(`fatal: ${err}\n`);
    process.exit(1);
});
//# sourceMappingURL=daemon.js.map