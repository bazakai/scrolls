# Models and runtime

The questions everyone asks first: what runs where, what gets downloaded, and what infrastructure you need.

## TL;DR

**You need nothing.** No GPU, no Python, no Ollama, no MLX, no Docker, no API keys, no accounts. The embedding model is a ~90MB ONNX file that downloads automatically from HuggingFace on first use and runs on your CPU via Node.js. After that one download, scrolls is fully offline.

## The stack, precisely

```
your text ──▶ @huggingface/transformers (transformers.js)
                    │  tokenize + run the ONNX graph
                    ▼
              onnxruntime-node (prebuilt native binary, CPU execution provider)
                    │  384-dim float vector, mean-pooled, normalized
                    ▼
              sqlite-vec (vec0 virtual table inside SQLite)
```

- **Model:** [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) - a 22M-parameter sentence-transformer, 384 dimensions, fp32 ONNX (~90MB on disk).
- **Runtime:** `onnxruntime-node` ships prebuilt CPU binaries for macOS (arm64/x64) and Linux (x64/arm64). No node-gyp compile for ONNX; `better-sqlite3` is the one dependency that compiles natively at install.
- **CPU only, on purpose.** The prebuilt ONNX binaries don't include CoreML/Metal/CUDA, and we don't want them to: steady-state indexing is a trickle (tens of chunks per minute) that an accelerator wouldn't change user-visibly, and GPU paths would cost install fragility. The one compute-heavy moment is the initial backfill: measured at ~20 chunks/sec on Apple Silicon, so a very large history (150k chunks ≈ 8,500 sessions) takes about two hours of background CPU, once. Typical histories finish in minutes to tens of minutes.

## Is it MLX? Could it be?

No. MLX is Apple's Swift/Python ML stack; as of mid-2026 there is no production path to run embeddings from Node.js without a Python sidecar, which would break the zero-config install. We evaluated it and rejected it deliberately - at 22M parameters the CPU is already fast enough that an accelerator changes nothing user-visible. If Apple ships a Node-reachable embeddings API, we'll revisit.

## What downloads, when, and where

| What | When | From | To | Size |
|------|------|------|----|----- |
| npm dependencies | plugin first run (`SessionStart` bootstrap) or `npm install` | npm registry | `node_modules/` inside the install dir | ~400MB |
| Embedding model | first embedding (daemon start, or first search in a session) | HuggingFace Hub | `node_modules/@huggingface/transformers/.cache/Xenova/all-MiniLM-L6-v2/` | ~90MB |

Notes:

- The model cache lives **inside the install directory's `node_modules`**, so it's removed when you remove the install, and two separate checkouts each download their own copy. The daemon and all per-session MCP servers of one install share one cache.
- After the model is cached, **no network access happens at all**. Air-gapped operation works: install and trigger one embedding while online (or copy the cache dir from another machine), then go offline.
- The download is the standard transformers.js flow - no auth, no account, plain HTTPS from `huggingface.co`.

## Swapping the model

`SCROLLS_MODEL` accepts any transformers.js-compatible feature-extraction model; set `SCROLLS_DIMS` to its output dimensions. The vector table is created with the configured dimensions, so **changing models requires rebuilding the index** (delete `~/.claude/scrolls/index.db*`, restart the daemon, re-run backfill). Worthwhile upgrades at the same 384 dims include `bge-small-en-v1.5` and `snowflake-arctic-embed-s`; a default upgrade is planned for v1.1.

## Resource footprint

| Process | RAM (model loaded) | CPU |
|---------|--------------------|----|
| Daemon | ~200-300MB RSS | bursts while indexing, idle otherwise |
| MCP server (per session) | ~50MB until first search; ~200-300MB after | one query embedding per search |

The MCP server loads the model lazily on the first `search_sessions` call, so sessions that never search stay light.
