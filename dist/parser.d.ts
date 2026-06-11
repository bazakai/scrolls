export interface ParsedChunk {
    uuid: string;
    sessionId: string;
    cwd: string;
    ts: string;
    kind: "user" | "assistant" | "tool_use" | "tool_result";
    text: string;
    isSidechain: boolean;
}
export declare function parseLine(line: string): ParsedChunk[];
export declare function projectFromPath(transcriptPath: string): string;
//# sourceMappingURL=parser.d.ts.map