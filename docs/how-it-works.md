# How it works

## The flow

```
Claude Code session
      │
      │ hooks fire on: SessionStart, UserPromptSubmit, PostToolUse, Stop
      ▼
hooks/ingest.sh ── POST {transcript_path} ──▶ daemon (127.0.0.1:48642)
                                                    │
                                              debounce 1.5s per file
                                                    │
                                              serial index queue
                                                    │
                                       read ONLY new bytes of the JSONL
                                       (per-file byte offset in SQLite)
                                                    │
                                       parse → chunk (1500 chars, 200 overlap)
                                                    │
                                       embed locally (MiniLM, 384-dim, CPU)
                                                    │
                                       one transaction: chunks + vec_chunks
                                       (sqlite-vec) + chunks_fts (FTS5)
                                                    │
                              ┌─────────────────────┴─────────────────┐
                              ▼                                       ▼
                  MCP server (per session,                ~/.claude/scrolls/index.db
                  stdio, read-only)                       (SQLite, WAL mode)
                              │
                    search_sessions / get_session_window / index_status
```

## Components and processes

- **Hooks** (bash + curl, fire-and-forget, `async: true`): tell the daemon "this transcript changed". They never block your session; a dropped event is harmless because indexing is offset-based and the next event (or the daemon's startup sweep) catches up.
- **Daemon** (one per machine): the only process that writes the index. Started lazily by `SessionStart`; survives nothing (no launchd/systemd) and doesn't need to - the next session start brings it back, and its startup backfill sweep recovers anything written while it was down. Details in [the-daemon.md](the-daemon.md).
- **MCP server** (one per Claude session, managed by Claude Code): read-only access to the index. Search works even when the daemon is down; you just won't get brand-new content until it returns.

## What gets captured

From every transcript line (main sessions and subagent sidechains):

| Captured | Detail |
|----------|--------|
| User messages | full text, chunked |
| Assistant messages | full text, chunked; **thinking blocks excluded** |
| Tool calls | tool name + first 800 chars of the input JSON |
| Tool results | first 1,200 chars of text content |

Excluded: thinking blocks, meta entries, images/binary content. Subagent transcripts are tagged (`is_sidechain`, `source`) so context windows never interleave a subagent's chunks with the parent conversation.

## Hybrid search, explained

A query runs through two independent retrievers and a fusion step:

1. **Semantic branch:** the query is embedded (same model as indexing) and sqlite-vec returns the nearest chunks by cosine distance. If metadata filters (project, kind, time) starve the candidate set, the search automatically widens its retrieval depth (k: 160 → 640 → 2,560) until enough in-filter candidates are found or the relevance floor is crossed.
2. **Keyword branch:** the query runs against an FTS5 index (BM25 ranking, porter stemming). Exact-substring filters add a literal scan for identifiers like ticket numbers.
3. **Reciprocal rank fusion:** each chunk's final score is `0.7 × 1/(60 + semantic_rank) + 0.3 × 1/(60 + keyword_rank)`. Rank-based fusion is robust to the two branches' incomparable score scales; 60 is the literature-standard constant.
4. **Relevance floor:** semantic candidates with cosine distance above 1.15 are discarded. The threshold was measured empirically on a ~150k-chunk index: on-topic results sit at 0.80-1.11, unrelated queries at 1.15+. This is why a nonsense query returns an empty result with a "reformulate" note instead of ten confident-looking junk hits - for a tool consumed by an agent, returning nothing beats returning garbage it will cite.

Results are deduplicated per message and returned as 700-char snippets; `get_session_window` then pulls the verbatim surrounding conversation for any hit.

## Where the LLM isn't

It's worth being precise, because most tools in this category work differently: scrolls never calls a language model. Embedding is not generation - it's a 22M-parameter encoder producing vectors, locally. Nothing is summarized, nothing is sent to any API, and nothing is injected into your context automatically (search happens only when you or Claude ask for it, so there is no token tax at session start). The full cost model is: your CPU, ~90MB of disk for the model, and the index itself.
