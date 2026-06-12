# Why scrolls?

## The pitch

Claude Code writes a complete transcript of every session to disk, then gives you almost no way to use it. Native memory keeps a small set of curated notes; `/resume` lists sessions by recency. Neither answers: *"where did we debug that SQLITE_BUSY error three weeks ago?"* or *"what did we decide about the retry queue, and in which repo?"*

scrolls makes your entire Claude Code history searchable:

- **Real hybrid retrieval.** Neural embeddings (semantic) fused with FTS5/BM25 (keyword) via reciprocal rank fusion, with a measured relevance floor so weak matches return empty instead of confidently wrong. Most tools in this space do one or the other; the fusion is what makes both "the cookie-banner fix" (vague, semantic) and "RDBAZ-404" (exact, lexical) findable.
- **Zero ongoing cost.** Indexing is pure local compute: a small embedding model on your CPU. No LLM is ever called, so there are no summarization passes, no API bills, and no token tax on your sessions. Tools that compress history with an LLM spend your tokens every session; their issue trackers show what users think of that.
- **Local and passive.** It reads transcript files Claude Code already writes, on your machine. The only network access in its lifetime is a one-time ~90MB model download from HuggingFace. Nothing is sent anywhere, ever. There is no telemetry.
- **Lossless.** Because nothing is summarized, nothing is lost. You search what was actually said, including tool calls and their output, and can pull the verbatim surrounding conversation.

## The anti-pitch: why you might NOT want scrolls

- **It runs a background daemon.** One long-lived local process (localhost-only, started lazily by a hook). If you don't want any resident process, this tool isn't for you. See [the-daemon.md](the-daemon.md).
- **First run is heavy.** Native dependency builds plus a ~90MB model download. A couple of minutes, once per install.
- **The index is a second copy of your transcripts.** Unencrypted, including any secrets that ever appeared in tool output. If that's unacceptable in your threat model, don't install it. See [privacy-and-data.md](privacy-and-data.md).
- **There are no content-exclusion filters yet.** You can't currently mark a repo or pattern as "never index". The only scoping is which projects directory is indexed.
- **The embedding model is small and English-leaning.** Semantic recall on long chunks and non-English text is limited (full-text search still covers them). A drop-in model upgrade is planned.
- **Claude Code only.** episodic-memory and memex also cover Codex; scrolls doesn't yet.
- **Anthropic could ship native transcript search.** If that happens, this whole category shrinks. We think the local-first, zero-config version stays useful; you may disagree.
- **It's young.** Fewer users and fewer accumulated platform fixes than episodic-memory.

## How it compares

|                                | scrolls | episodic-memory | claude-mem | memex | CC native memory |
|--------------------------------|---------|-----------------|------------|-------|------------------|
| Searches raw transcripts       | yes     | yes             | compressed copies | yes | no (curated notes) |
| Keyword search                 | FTS5/BM25 + RRF fusion | SQLite `LIKE` | FTS5 over summaries | BM25 | grep |
| LLM calls                      | never   | optional (Haiku summaries) | yes (core mechanism) | never | never |
| Ongoing token/API cost         | zero    | zero-to-small   | significant | zero  | zero |
| Claude Code plugin             | yes     | yes             | yes        | no (Homebrew TUI) | built-in |
| Codex / other harnesses        | no      | yes             | yes        | yes   | no |
| Context injected automatically | no (search on demand) | no | yes (session start) | no | yes (notes) |
| Relevance floor on results     | yes     | no              | n/a        | no    | n/a |

**Choose scrolls if** you want maximum retrieval quality over your raw history at zero ongoing cost, inside Claude Code.

**Choose episodic-memory if** you also use Codex, want optional LLM summaries as memory, or prefer the more battle-tested project in this niche.

**Choose claude-mem if** you want history actively compressed and injected into context automatically and you're fine paying tokens for it.

**Choose memex if** you want a standalone TUI to browse and resume sessions across multiple agents, outside the plugin system.

**Native memory is not an alternative** - it's a complement. Keep it on. It remembers what should always be true; scrolls finds what actually happened.

## Bias disclosure

We built scrolls, so read the table above accordingly. Every row is checkable against the linked projects, and the retrieval claims are measurable on your own machine: the relevance floor and hybrid behavior are covered by `npm test` against your own index. If you find a row that's wrong or stale, open an issue - we'll fix it.
