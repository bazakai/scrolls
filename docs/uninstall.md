# Uninstall

Complete removal, by install method. scrolls never modifies your transcripts (`~/.claude/projects/`), so uninstalling can't lose any original data.

Cleanup is also built in, not just documented:

- **The daemon detects uninstall.** It checks once a minute that its install directory still exists; when the plugin (or clone) is deleted, it logs `install directory removed — shutting down` and exits on its own. No orphaned process survives an uninstall by more than a minute.
- **Superseded plugin versions self-prune.** Each plugin update leaves the previous version's directory (with its ~500MB of node_modules + model cache) in Claude Code's plugin cache; the bootstrap hook removes lower versions after a 2-day grace period (grace because sessions started before the update may still run the old version's MCP server).

## Plugin install

```bash
# 1. Stop the daemon and delete local data + cached install trees
~/.claude/plugins/cache/scrolls/scrolls/*/scripts/uninstall.sh --purge-data --purge-cache
# (omit --purge-data to keep the index for a later reinstall;
#  omit --purge-cache to keep the cached install)

# 2. Unregister the plugin and marketplace
claude plugin uninstall scrolls@scrolls
claude plugin marketplace remove scrolls
```

**Why `--purge-cache` matters:** `claude plugin uninstall` only *unregisters* the plugin — verified empirically, it does **not** delete `~/.claude/plugins/cache/scrolls/`, which holds every cached version with its node_modules and embedding-model cache (~500MB per version). The script flag is what actually frees that disk.

Forgot step 1 and unregistered first? Fine: the daemon exits by itself within a minute of the cache being deleted, and cleanup is two `rm -rf`s: `~/.claude/scrolls` (data) and `~/.claude/plugins/cache/scrolls` (cache).

## Manual install

```bash
# 1. Stop the daemon (and optionally purge data)
/path/to/scrolls/scripts/uninstall.sh --purge-data

# 2. Remove the MCP registration
claude mcp remove --scope user scrolls

# 3. Remove the four hook entries (SessionStart/UserPromptSubmit/PostToolUse/Stop
#    pointing at .../scrolls/hooks/) from ~/.claude/settings.json

# 4. Delete the clone (includes node_modules and the model cache)
rm -rf /path/to/scrolls
```

## Delete the data but keep the tool

```bash
./scripts/uninstall.sh --purge-data   # stops daemon + removes ~/.claude/scrolls
```

The daemon rebuilds an empty index on next session start; backfill again whenever you like.

## What's on disk, for reference

| Artifact | Path | Removed by |
|----------|------|------------|
| Index, logs, pid/lock | `~/.claude/scrolls/` | `uninstall.sh --purge-data` (or `rm -rf`) |
| Plugin code + deps + model cache | `~/.claude/plugins/cache/scrolls/` | `uninstall.sh --purge-cache` (NOT removed by `claude plugin uninstall`) |
| Hooks/MCP wiring (plugin install) | Claude Code's plugin registry | `claude plugin uninstall` + `marketplace remove` |
| Your transcripts | `~/.claude/projects/` | never touched by scrolls |
