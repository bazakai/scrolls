import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { openDb, initSchema, DB_PATH } from "./db.js";
import { DAEMON_PORT } from "./config.js";
import { hybridSearch, getSessionWindow } from "./search.js";
import { getModelState } from "./embedder.js";
const SearchParams = z.object({
    query: z.string(),
    project: z.string().optional(),
    kind: z.enum(["user", "assistant", "tool_use", "tool_result"]).optional(),
    limit: z.number().int().min(1).max(50).default(10),
    after: z.string().optional(),
    before: z.string().optional(),
    exact: z.string().optional(),
    order: z.enum(["relevance", "recent"]).default("relevance"),
});
const WindowParams = z
    .object({
    sessionId: z.string(),
    uuid: z.string().optional(),
    timestamp: z.string().optional(),
    radius: z.number().int().min(1).max(20).default(6),
})
    .refine((p) => p.uuid || p.timestamp, {
    message: "Provide either uuid or timestamp as the anchor",
});
async function main() {
    // Readonly open throws SQLITE_CANTOPEN on a missing file, so the schema must
    // be created (writable connection) before the readonly handle is opened.
    const init = openDb();
    initSchema(init);
    init.close();
    const db = openDb(true);
    const { version } = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
    const server = new Server({ name: "scrolls", version }, { capabilities: { tools: {} } });
    // The embedding model is NOT preloaded here: one MCP server is spawned per
    // Claude session and most sessions never search. It loads lazily on the
    // first search_sessions call instead.
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: "search_sessions",
                description: "Semantically search all past Claude Code sessions on this machine. " +
                    "Use this to find prior discussions, decisions, implementations, bugs fixed, " +
                    "or any topic across every conversation ever held in Claude Code. " +
                    "Combines vector similarity and full-text search for best results. " +
                    "Strategy: specific domain terms and distinctive identifiers beat generic phrases — " +
                    "if results look weak, try 2-3 reformulations. " +
                    "Returns {results: [...]}; an empty results array means nothing cleared the relevance floor " +
                    "(reformulate rather than trusting weak hits). " +
                    "Note: results reflect what was DISCUSSED in sessions, which may differ from what finally shipped in git.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Natural-language search query",
                        },
                        project: {
                            type: "string",
                            description: "Filter to a specific project folder name (e.g. -Users-jane-dev-my-app)",
                        },
                        kind: {
                            type: "string",
                            enum: ["user", "assistant", "tool_use", "tool_result"],
                            description: "Filter to a message kind",
                        },
                        limit: {
                            type: "number",
                            description: "Max results (default 10, max 50)",
                            default: 10,
                        },
                        after: {
                            type: "string",
                            description: "ISO timestamp — only return chunks after this time",
                        },
                        before: {
                            type: "string",
                            description: "ISO timestamp — only return chunks before this time",
                        },
                        exact: {
                            type: "string",
                            description: "Exact substring that must appear in the chunk text (case-insensitive) — " +
                                "use for identifiers like ticket numbers, function names, or error strings",
                        },
                        order: {
                            type: "string",
                            enum: ["relevance", "recent"],
                            description: "'relevance' (default) ranks by hybrid match quality; " +
                                "'recent' returns relevant candidates sorted newest-first",
                            default: "relevance",
                        },
                    },
                    required: ["query"],
                },
            },
            {
                name: "get_session_window",
                description: "Retrieve surrounding conversation context around a point in a past Claude Code session. " +
                    "Anchor by uuid (from a search_sessions hit) OR by an ISO timestamp (nearest chunk in that session). " +
                    "Returns a flat ordered list of chunks before and after the anchor so you can read the full surrounding context.",
                inputSchema: {
                    type: "object",
                    properties: {
                        sessionId: {
                            type: "string",
                            description: "Session ID from a search_sessions hit",
                        },
                        uuid: {
                            type: "string",
                            description: "UUID of the anchor chunk from a search_sessions hit",
                        },
                        timestamp: {
                            type: "string",
                            description: "ISO timestamp anchor — used when uuid is not provided; resolves to the nearest chunk in the session",
                        },
                        radius: {
                            type: "number",
                            description: "Chunks before and after to return (default 6, max 20)",
                            default: 6,
                        },
                    },
                    required: ["sessionId"],
                },
            },
            {
                name: "index_status",
                description: "Check the current state of the scrolls index: how many files and chunks are indexed, " +
                    "whether the background daemon is running, the DB path, and the embedding model state.",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: [],
                },
            },
        ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        if (name === "search_sessions") {
            const params = SearchParams.parse(args);
            const hits = await hybridSearch({
                db,
                query: params.query,
                filters: {
                    project: params.project,
                    kind: params.kind,
                    after: params.after,
                    before: params.before,
                    exact: params.exact,
                },
                limit: params.limit,
                order: params.order,
            });
            const payload = hits.length > 0
                ? { results: hits }
                : {
                    results: [],
                    note: "No strong matches. Try different phrasing, a distinctive identifier, or fewer filters.",
                };
            return {
                content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
            };
        }
        if (name === "get_session_window") {
            const params = WindowParams.parse(args);
            const chunks = getSessionWindow({
                db,
                sessionId: params.sessionId,
                uuid: params.uuid,
                timestamp: params.timestamp,
                radius: params.radius,
            });
            return {
                content: [{ type: "text", text: JSON.stringify(chunks, null, 2) }],
            };
        }
        if (name === "index_status") {
            const filesCount = db.prepare("SELECT COUNT(*) as n FROM files").get().n;
            const chunksCount = db.prepare("SELECT COUNT(*) as n FROM chunks").get().n;
            const vecCount = db.prepare("SELECT COUNT(*) as n FROM vec_chunks").get().n;
            let daemonReachable = false;
            try {
                const resp = await fetch(`http://127.0.0.1:${DAEMON_PORT}/health`, {
                    signal: AbortSignal.timeout(1000),
                });
                daemonReachable = resp.ok;
            }
            catch {
                daemonReachable = false;
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            dbPath: DB_PATH,
                            filesTracked: filesCount,
                            chunks: chunksCount,
                            vecRows: vecCount,
                            modelState: getModelState(),
                            daemonReachable,
                        }, null, 2),
                    },
                ],
            };
        }
        throw new Error(`Unknown tool: ${name}`);
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    process.stderr.write(`fatal: ${err}\n`);
    process.exit(1);
});
