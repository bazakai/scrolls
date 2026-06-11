import { spawn } from "child_process";
import { createInterface } from "readline";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const proc = spawn("node", ["dist/mcp-server.js"], {
  cwd: projectRoot,
  stdio: ["pipe", "pipe", "inherit"],
});

const rl = createInterface({ input: proc.stdout });
const pending = new Map();
let msgId = 1;
let failures = 0;

function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function request(method, params) {
  const id = msgId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
    setTimeout(() => reject(new Error(`timeout ${method}`)), 120000);
  });
}

rl.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  } catch {}
});

async function call(name, args) {
  const result = await request("tools/call", { name, arguments: args });
  return JSON.parse(result.content[0].text);
}

async function main() {
  const init = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1.0" },
  });
  check("initialize", init.serverInfo?.name === "scrolls");

  const { tools } = await request("tools/list", {});
  const names = tools.map((t) => t.name).sort();
  check(
    "tool surface is exactly 3 tools",
    JSON.stringify(names) ===
      JSON.stringify(["get_session_window", "index_status", "search_sessions"]),
    names.join(","),
  );
  const search = tools.find((t) => t.name === "search_sessions");
  for (const param of ["query", "project", "kind", "after", "before", "exact", "order"]) {
    check(`search_sessions has ${param} param`, param in search.inputSchema.properties);
  }

  const status = await call("index_status", {});
  check("index_status returns counts", typeof status.chunks === "number");
  const indexIsPopulated = status.chunks > 1000;

  if (!indexIsPopulated) {
    console.log(
      `\nindex has only ${status.chunks} chunks — skipping retrieval-quality checks (run a backfill first for full coverage)`,
    );
  } else {
    const good = await call("search_sessions", {
      query: "hybrid search sqlite-vec FTS5 reciprocal rank fusion",
      limit: 5,
    });
    check("on-topic query returns results", good.results.length > 0);
    if (good.results.length > 0) {
      const hit = good.results[0];
      for (const field of ["rank", "matchType", "timestamp", "sessionId", "project", "kind", "text", "uuid"]) {
        check(`hit has ${field}`, field in hit);
      }
      check("snippet capped at 700 chars", good.results.every((h) => h.text.length <= 700));

      const win = await call("get_session_window", {
        sessionId: hit.sessionId,
        uuid: hit.uuid,
        radius: 3,
      });
      check("window around hit is non-empty", win.length > 0);
      check(
        "window seqs are ordered",
        win.every((c, i) => i === 0 || c.seq >= win[i - 1].seq),
      );
    }

    const garbage = await call("search_sessions", {
      query: "grandma's secret chocolate babka recipe with extra cinnamon",
      limit: 5,
    });
    check(
      "garbage query is floored (empty results + note)",
      garbage.results.length === 0 && typeof garbage.note === "string",
      `got ${garbage.results.length} results`,
    );

    const recent = await call("search_sessions", {
      query: "fix bug error",
      order: "recent",
      limit: 5,
    });
    const ts = recent.results.map((h) => h.timestamp);
    check(
      "order=recent is newest-first",
      JSON.stringify(ts) === JSON.stringify([...ts].sort().reverse()),
    );
  }

  proc.kill();
  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  proc.kill();
  process.exit(1);
});
