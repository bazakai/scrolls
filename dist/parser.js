const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
function splitText(text) {
    if (text.length <= CHUNK_SIZE)
        return [text];
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        chunks.push(text.slice(start, start + CHUNK_SIZE));
        start += CHUNK_SIZE - CHUNK_OVERLAP;
    }
    return chunks;
}
function extractToolResultText(content) {
    if (typeof content === "string")
        return content.slice(0, 1200);
    if (Array.isArray(content)) {
        const texts = [];
        for (const block of content) {
            if (block.type === "text" && block.text) {
                texts.push(block.text);
            }
        }
        return texts.join("\n").slice(0, 1200);
    }
    return "";
}
export function parseLine(line) {
    let entry;
    try {
        entry = JSON.parse(line);
    }
    catch {
        return [];
    }
    const type = entry.type;
    if (!type || entry.isMeta)
        return [];
    const uuid = entry.uuid;
    const sessionId = entry.sessionId;
    const cwd = entry.cwd ?? "";
    const ts = entry.timestamp ?? "";
    const isSidechain = entry.isSidechain === true;
    if (!uuid || !sessionId)
        return [];
    const chunks = [];
    const push = (kind, text) => chunks.push({ uuid, sessionId, cwd, ts, kind, text, isSidechain });
    if (type === "user") {
        const message = entry.message;
        if (!message)
            return [];
        const content = message.content;
        if (typeof content === "string") {
            const trimmed = content.trim();
            if (trimmed) {
                for (const segment of splitText(trimmed)) {
                    push("user", segment);
                }
            }
        }
        else if (Array.isArray(content)) {
            for (const block of content) {
                if (block.type === "text" && block.text?.trim()) {
                    for (const segment of splitText(block.text.trim())) {
                        push("user", segment);
                    }
                }
                else if (block.type === "tool_result") {
                    const text = extractToolResultText(block.content);
                    if (text.trim()) {
                        push("tool_result", text.trim());
                    }
                }
            }
        }
    }
    else if (type === "assistant") {
        const message = entry.message;
        if (!message)
            return [];
        const content = message.content;
        if (!Array.isArray(content))
            return [];
        for (const block of content) {
            if (block.type === "thinking")
                continue;
            if (block.type === "text" && block.text?.trim()) {
                for (const segment of splitText(block.text.trim())) {
                    push("assistant", segment);
                }
            }
            else if (block.type === "tool_use" && block.name) {
                const inputStr = JSON.stringify(block.input ?? {}).slice(0, 800);
                push("tool_use", `${block.name}: ${inputStr}`);
            }
        }
    }
    return chunks.filter((c) => c.text.trim().length > 0);
}
export function projectFromPath(transcriptPath) {
    const claudeProjects = "/.claude/projects/";
    const idx = transcriptPath.indexOf(claudeProjects);
    if (idx === -1)
        return "";
    const rest = transcriptPath.slice(idx + claudeProjects.length);
    const slash = rest.indexOf("/");
    return slash === -1 ? rest : rest.slice(0, slash);
}
//# sourceMappingURL=parser.js.map