import { MODEL_ID, EMBEDDING_DIMS } from "./config.js";
const BATCH_SIZE = 16;
let pipeline = null;
let loadingPromise = null;
let modelState = "loading";
export function getModelState() {
    return modelState;
}
async function getPipeline() {
    if (pipeline)
        return pipeline;
    if (loadingPromise)
        return loadingPromise;
    loadingPromise = (async () => {
        const { pipeline: createPipeline } = await import("@huggingface/transformers");
        const p = (await createPipeline("feature-extraction", MODEL_ID, {
            dtype: "fp32",
        }));
        pipeline = p;
        modelState = "loaded";
        return p;
    })();
    return loadingPromise;
}
export async function preloadModel() {
    await getPipeline();
}
export async function embedBatch(texts) {
    const p = await getPipeline();
    const results = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        // output is a single Tensor with dims [batchSize, EMBEDDING_DIMS]
        const output = await p(batch, { pooling: "mean", normalize: true });
        const flat = output.data;
        const dims = EMBEDDING_DIMS;
        for (let j = 0; j < batch.length; j++) {
            results.push(flat.slice(j * dims, (j + 1) * dims));
        }
    }
    return results;
}
export async function embedOne(text) {
    const [vec] = await embedBatch([text]);
    return vec;
}
