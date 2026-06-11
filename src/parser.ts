export interface ParsedChunk {
  uuid: string;
  sessionId: string;
  cwd: string;
  ts: string;
  kind: "user" | "assistant" | "tool_use" | "tool_result";
  text: string;
  isSidechain: boolean;
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

function splitText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    chunks.push(text.slice(start, start + CHUNK_SIZE));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 1200);

  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (block.type === "text" && block.text) {
        texts.push(block.text);
      }
    }
    return texts.join("\n").slice(0, 1200);
  }

  return "";
}

export function parseLine(line: string): ParsedChunk[] {
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line);
  } catch {
    return [];
  }

  const type = entry.type as string;
  if (!type || (entry.isMeta as boolean)) return [];

  const uuid = entry.uuid as string;
  const sessionId = entry.sessionId as string;
  const cwd = (entry.cwd as string) ?? "";
  const ts = (entry.timestamp as string) ?? "";
  const isSidechain = entry.isSidechain === true;

  if (!uuid || !sessionId) return [];

  const chunks: ParsedChunk[] = [];
  const push = (kind: ParsedChunk["kind"], text: string) =>
    chunks.push({ uuid, sessionId, cwd, ts, kind, text, isSidechain });

  if (type === "user") {
    const message = entry.message as { content?: unknown } | undefined;
    if (!message) return [];

    const content = message.content;

    if (typeof content === "string") {
      const trimmed = content.trim();
      if (trimmed) {
        for (const segment of splitText(trimmed)) {
          push("user", segment);
        }
      }
    } else if (Array.isArray(content)) {
      for (const block of content as ContentBlock[]) {
        if (block.type === "text" && block.text?.trim()) {
          for (const segment of splitText(block.text.trim())) {
            push("user", segment);
          }
        } else if (block.type === "tool_result") {
          const text = extractToolResultText(block.content);
          if (text.trim()) {
            push("tool_result", text.trim());
          }
        }
      }
    }
  } else if (type === "assistant") {
    const message = entry.message as { content?: unknown } | undefined;
    if (!message) return [];

    const content = message.content;
    if (!Array.isArray(content)) return [];

    for (const block of content as ContentBlock[]) {
      if (block.type === "thinking") continue;

      if (block.type === "text" && block.text?.trim()) {
        for (const segment of splitText(block.text.trim())) {
          push("assistant", segment);
        }
      } else if (block.type === "tool_use" && block.name) {
        const inputStr = JSON.stringify(block.input ?? {}).slice(0, 800);
        push("tool_use", `${block.name}: ${inputStr}`);
      }
    }
  }

  return chunks.filter((c) => c.text.trim().length > 0);
}

export function projectFromPath(transcriptPath: string): string {
  const claudeProjects = "/.claude/projects/";
  const idx = transcriptPath.indexOf(claudeProjects);
  if (idx === -1) return "";

  const rest = transcriptPath.slice(idx + claudeProjects.length);
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}
