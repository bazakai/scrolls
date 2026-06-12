import { embedOne } from "./embedder.js";
import { RELEVANCE_FLOOR, CANDIDATE_LIMIT, RRF_K } from "./config.js";
const VEC_WEIGHT = 0.7;
const FTS_WEIGHT = 0.3;
const SNIPPET_LENGTH = 700;
const MAX_KNN = 2560;
function escapeFtsQuery(query) {
    // Wrap every token in double quotes so non-alphanumerics (RDBAZ-404, file.ts)
    // match as phrases instead of being parsed as FTS5 operators.
    const words = query
        .replace(/['"*^()]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 0);
    if (words.length === 0)
        return '""';
    return words.map((w) => `"${w}"`).join(" ");
}
function escapeLikePattern(value) {
    return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}
function makeSnippet(text) {
    if (text.length <= SNIPPET_LENGTH)
        return text;
    const cut = text.slice(0, SNIPPET_LENGTH);
    const lastSpace = cut.lastIndexOf(" ");
    return lastSpace > SNIPPET_LENGTH / 2 ? cut.slice(0, lastSpace) : cut;
}
function buildFilterClauses(filters) {
    const clauses = [];
    const params = [];
    if (filters.project) {
        clauses.push("c.project = ?");
        params.push(filters.project);
    }
    if (filters.kind) {
        clauses.push("c.kind = ?");
        params.push(filters.kind);
    }
    if (filters.after) {
        clauses.push("c.ts >= ?");
        params.push(filters.after);
    }
    if (filters.before) {
        clauses.push("c.ts <= ?");
        params.push(filters.before);
    }
    if (filters.exact) {
        clauses.push("c.text LIKE ? ESCAPE '\\'");
        params.push(`%${escapeLikePattern(filters.exact)}%`);
    }
    return { clauses, params };
}
export async function hybridSearch({ db, query, filters = {}, limit = 10, order = "relevance", }) {
    const queryVec = await embedOne(query);
    const { clauses: filterClauses, params: filterParams } = buildFilterClauses(filters);
    // sqlite-vec 0.1.x KNN: must be a simple table query; JOINs are not supported
    // in the MATCH form, so metadata filters are applied in a second pass. With a
    // selective filter the global top-k can contain zero matching rows, so widen
    // k until enough survivors are found or the relevance floor is crossed.
    let vecRows = [];
    for (let knn = CANDIDATE_LIMIT * 4;; knn *= 4) {
        const vecRowsRaw = db
            .prepare(`SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ? AND k=${knn} ORDER BY distance`)
            .all(queryVec);
        const withinFloor = vecRowsRaw.filter((r) => r.distance <= RELEVANCE_FLOOR);
        if (filterParams.length > 0 && withinFloor.length > 0) {
            const ph = withinFloor.map(() => "?").join(",");
            const filtered = db
                .prepare(`SELECT id FROM chunks c WHERE c.id IN (${ph}) AND ${filterClauses.join(" AND ")}`)
                .all(...withinFloor.map((r) => r.rowid), ...filterParams);
            const filteredSet = new Set(filtered.map((r) => r.id));
            vecRows = withinFloor.filter((r) => filteredSet.has(r.rowid));
        }
        else {
            vecRows = withinFloor;
        }
        const floorReached = vecRowsRaw.length > 0 &&
            vecRowsRaw[vecRowsRaw.length - 1].distance > RELEVANCE_FLOOR;
        const corpusExhausted = vecRowsRaw.length < knn;
        if (vecRows.length >= CANDIDATE_LIMIT ||
            floorReached ||
            corpusExhausted ||
            knn >= MAX_KNN) {
            vecRows = vecRows.slice(0, CANDIDATE_LIMIT);
            break;
        }
    }
    // FTS5 with optional metadata filters
    const ftsEscaped = escapeFtsQuery(query);
    const ftsClauses = [...filterClauses, "chunks_fts MATCH ?"];
    const ftsRows = db
        .prepare(`SELECT c.id as rowid, f.rank
       FROM chunks_fts f
       INNER JOIN chunks c ON c.id = f.rowid
       WHERE ${ftsClauses.join(" AND ")}
       ORDER BY f.rank
       LIMIT ${CANDIDATE_LIMIT}`)
        .all(...filterParams, ftsEscaped);
    // Keyword branch = FTS hits, plus (when exact is set) a direct substring scan so
    // identifier lookups still hit even when neither FTS terms nor KNN surface them.
    const keywordIds = ftsRows.map((r) => r.rowid);
    if (filters.exact) {
        const seen = new Set(keywordIds);
        const exactRows = db
            .prepare(`SELECT c.id FROM chunks c
         WHERE ${filterClauses.join(" AND ")}
         ORDER BY c.ts DESC
         LIMIT ${CANDIDATE_LIMIT}`)
            .all(...filterParams);
        for (const { id } of exactRows) {
            if (!seen.has(id)) {
                seen.add(id);
                keywordIds.push(id);
            }
        }
    }
    // Reciprocal Rank Fusion
    const vecRanks = new Map();
    const keywordRanks = new Map();
    vecRows.forEach((r, i) => vecRanks.set(r.rowid, i + 1));
    keywordIds.forEach((id, i) => keywordRanks.set(id, i + 1));
    const allIds = new Set([...vecRanks.keys(), ...keywordRanks.keys()]);
    const scored = [];
    for (const id of allIds) {
        let score = 0;
        const vr = vecRanks.get(id);
        const kr = keywordRanks.get(id);
        if (vr !== undefined)
            score += VEC_WEIGHT * (1 / (RRF_K + vr));
        if (kr !== undefined)
            score += FTS_WEIGHT * (1 / (RRF_K + kr));
        scored.push({ id, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const topIds = scored.slice(0, limit * 4).map((s) => s.id);
    if (topIds.length === 0)
        return [];
    const ph = topIds.map(() => "?").join(",");
    const chunkRows = db
        .prepare(`SELECT id, uuid, session_id, project, cwd, ts, kind, text, seq
       FROM chunks WHERE id IN (${ph})`)
        .all(...topIds);
    const byId = new Map(chunkRows.map((r) => [r.id, r]));
    function matchTypeFor(id) {
        const inVec = vecRanks.has(id);
        const inKeyword = keywordRanks.has(id);
        if (inVec && inKeyword)
            return "both";
        return inVec ? "semantic" : "keyword";
    }
    // Dedupe by uuid — keep the chunk with the highest RRF score
    const seenUuids = new Map();
    for (const { id, score } of scored) {
        const row = byId.get(id);
        if (!row)
            continue;
        const existing = seenUuids.get(row.uuid);
        if (!existing || score > existing.score) {
            seenUuids.set(row.uuid, { score, row, matchType: matchTypeFor(id) });
        }
    }
    const deduped = Array.from(seenUuids.values());
    if (order === "recent") {
        deduped.sort((a, b) => b.row.ts.localeCompare(a.row.ts));
    }
    else {
        deduped.sort((a, b) => b.score - a.score);
    }
    return deduped.slice(0, limit).map(({ row, matchType }, i) => ({
        rank: i + 1,
        matchType,
        timestamp: row.ts,
        sessionId: row.session_id,
        project: row.project,
        cwd: row.cwd,
        kind: row.kind,
        text: makeSnippet(row.text),
        uuid: row.uuid,
    }));
}
export function getSessionWindow({ db, sessionId, uuid, timestamp, radius = 6, }) {
    let anchor;
    if (uuid) {
        anchor = db
            .prepare(
        // A message can split into several chunks sharing one uuid — anchor on
        // the first so the window is deterministic.
        "SELECT seq, source FROM chunks WHERE session_id = ? AND uuid = ? ORDER BY seq ASC LIMIT 1")
            .get(sessionId, uuid);
    }
    else if (timestamp) {
        anchor = db
            .prepare(`SELECT seq, source FROM chunks
         WHERE session_id = ? AND julianday(ts) IS NOT NULL
         ORDER BY ABS(julianday(ts) - julianday(?)) ASC
         LIMIT 1`)
            .get(sessionId, timestamp);
    }
    if (!anchor)
        return [];
    // Sidechain transcripts (agent-*.jsonl) share the parent's session_id, so a
    // window must stay within the anchor's own transcript file or main-thread
    // and subagent chunks interleave. Empty source = pre-1.0 rows; no filter.
    const rows = db
        .prepare(`SELECT id, uuid, session_id, kind, text, ts, seq
       FROM chunks
       WHERE session_id = ? AND seq >= ? AND seq <= ?
         AND (source = ? OR ? = '')
       ORDER BY seq ASC`)
        .all(sessionId, anchor.seq - radius, anchor.seq + radius, anchor.source, anchor.source);
    return rows.map((r) => ({
        seq: r.seq,
        kind: r.kind,
        timestamp: r.ts,
        text: r.text,
    }));
}
