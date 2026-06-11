import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { MODEL_ID, EMBEDDING_DIMS } from "./config.js";

const BATCH_SIZE = 16;

let pipeline: FeatureExtractionPipeline | null = null;
let loadingPromise: Promise<FeatureExtractionPipeline> | null = null;
let modelState: "loading" | "loaded" = "loading";

export function getModelState(): "loading" | "loaded" {
  return modelState;
}

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (pipeline) return pipeline;

  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { pipeline: createPipeline } =
      await import("@huggingface/transformers");
    const p = (await createPipeline("feature-extraction", MODEL_ID, {
      dtype: "fp32",
    })) as FeatureExtractionPipeline;
    pipeline = p;
    modelState = "loaded";
    return p;
  })();

  return loadingPromise;
}

export async function preloadModel(): Promise<void> {
  await getPipeline();
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const p = await getPipeline();
  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    // output is a single Tensor with dims [batchSize, EMBEDDING_DIMS]
    const output = await p(batch, { pooling: "mean", normalize: true });
    const flat = output.data as Float32Array;
    const dims = EMBEDDING_DIMS;

    for (let j = 0; j < batch.length; j++) {
      results.push(flat.slice(j * dims, (j + 1) * dims));
    }
  }

  return results;
}

export async function embedOne(text: string): Promise<Float32Array> {
  const [vec] = await embedBatch([text]);
  return vec;
}
