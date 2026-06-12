# Uninstall

Complete removal, by install method. scrolls never modifies your transcripts (`~/.claude/projects/`), so uninstalling can't lose any original data.

## Plugin install

```bash
# 1. Remove the plugin (stops the MCP server and hooks for new sessions)
claude plugin uninstall scrolls@scrolls
claude plugin marketplace remove scrolls

# 2. Stop the daemon
kill "$(cat ~/.claude/scrolls/daemon.pid 2>/dev/null)" 2>/dev/null

# 3. Delete the index and state
rm -rf ~/.claude/scrolls
```

The embedding model cache and node_modules live inside the plugin's cache directory and are removed with the plugin.

## Manual install

```bash
# 1. Remove the MCP registration
claude mcp remove --scope user scrolls

# 2. Remove the four hook entries (SessionStart/UserPromptSubmit/PostToolUse/Stop
#    pointing at .../scrolls/hooks/) from ~/.claude/settings.json

# 3. Stop the daemon and delete state
kill "$(cat ~/.claude/scrolls/daemon.pid 2>/dev/null)" 2>/dev/null
rm -rf ~/.claude/scrolls

# 4. Delete the clone (includes node_modules and the model cache)
rm -rf /path/to/scrolls
```

## Delete the data but keep the tool

```bash
kill "$(cat ~/.claude/scrolls/daemon.pid)"
rm ~/.claude/scrolls/index.db ~/.claude/scrolls/index.db-wal ~/.claude/scrolls/index.db-shm
```

The daemon rebuilds an empty index on next start; backfill again whenever you like.
