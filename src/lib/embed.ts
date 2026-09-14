import path from "node:path";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Embeds a query into the frozen space, with the same model that embedded
 * the corpus.
 *
 * The corpus is embedded by corpus-pipeline/embed_corpus.py in the Trellis
 * repository. Until 2026-09-13 that was stock all-MiniLM-L6-v2, chosen on
 * 2026-09-03 by scoring candidates against the corpus's own citation labels.
 * It is now that model fine-tuned on the corpus's citation graph:
 * review-article-to-cited pairs with mined hard negatives, five rounds, the
 * recipe in that repository's corpus-pipeline/train_metric.py. On 437
 * held-out review articles it scores recall@50 of 0.3441 against 0.3080
 * untrained and 0.1008 for the TF-IDF projection it replaced.
 *
 * The weights are read from models/ at request time and are NOT in git: this
 * repository is public and the fine-tune is published nowhere. They are
 * fetched into models/ before the build (scripts/fetch-model.mjs) and traced
 * into the function that embeds (next.config.ts). Not from public/ either,
 * which is served to the open internet.
 *
 * fp32, not the 8-bit build stock MiniLM used. Quantizing costs 0.0060 recall
 * [-0.0120, -0.0002] -- measured, not assumed, by embedding the held-out
 * queries through each build and scoring both -- and 87 MB is inside the
 * function's limit, so there is nothing to buy with that loss. The fp32 export
 * reproduces the Python vectors exactly: cosine 1.0000 and identical recall.
 *
 * corpus_space.embedder names the model the vectors came from. A caller
 * compares it with EMBEDDER before searching: a query embedded by one model
 * into vectors made by another returns confident nonsense. Both sides change
 * together or the guard sends search back to the TF-IDF projection.
 */
export const EMBEDDER = "trellis/all-MiniLM-L6-v2-cite-r5";
export const ONNX_MODEL = "trellis-minilm-cite";
export const EMBEDDER_DIMS = 384;
/** Where the weights live, relative to the repository root. */
export const MODELS_DIR = "models";

let loading: Promise<FeatureExtractionPipeline> | null = null;

function load(): Promise<FeatureExtractionPipeline> {
  if (loading) return loading;
  loading = (async () => {
    // Imported on first use, not at module load. Importing the package
    // dlopens ONNX Runtime's native library, and every route that touches
    // placement would otherwise pay for that, or fail on it, before rendering
    // a word. Only a call that actually embeds text needs the runtime.
    const { env, pipeline } = await import("@huggingface/transformers");
    // Serverless filesystems are read-only outside /tmp.
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      env.cacheDir = "/tmp/transformers-cache";
    }
    /*
     * Local only. The weights ship with the deployment, so there is nothing to
     * download and no hub to be unreachable -- and allowRemoteModels left on
     * would silently fetch a DIFFERENT model of the same name from the hub if
     * the local files were ever missing, which is the one failure that returns
     * confident nonsense instead of an error.
     */
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = path.join(process.cwd(), MODELS_DIR);
    return (await pipeline("feature-extraction", ONNX_MODEL, {
      dtype: "fp32",
    })) as FeatureExtractionPipeline;
  })().catch((error) => {
    // A transient failure must not disable search for the life of the
    // instance.
    loading = null;
    throw error;
  });
  return loading;
}

/** Warms the model, for a caller that knows a query is coming. */
export function warmEmbedder(): void {
  void load().catch(() => undefined);
}

export async function embedQuery(text: string): Promise<number[]> {
  const extract = await load();
  // 512 tokens is the model's window; a few thousand characters is past it.
  const out = await extract(text.slice(0, 4000), { pooling: "mean", normalize: true });
  return Array.from(out.data as Float32Array);
}
