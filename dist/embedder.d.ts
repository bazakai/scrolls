export declare function getModelState(): "loading" | "loaded";
export declare function preloadModel(): Promise<void>;
export declare function embedBatch(texts: string[]): Promise<Float32Array[]>;
export declare function embedOne(text: string): Promise<Float32Array>;
//# sourceMappingURL=embedder.d.ts.map