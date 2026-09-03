import type { FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Embeds a query into the frozen space, with the same model that embedded
 * the corpus.
 *
 * The corpus is embedded by corpus-pipeline/embed_corpus.py in the Trellis
 * repository with sentence-transformers/all-MiniLM-L6-v2, chosen on
 * 2026-09-03 by scoring candidates against the corpus's own citation labels:
 * it triples the recall of the TF-IDF projection it replaces, and it is the
 * one candidate small enough to run inside a serverless function, so a
 * person's sentence is embedded here and goes nowhere else.
 *
 * This is the ONNX port of the same weights. Mean pooling and L2
 * normalization reproduce the Python vectors to four decimals at full
 * precision; the 8-bit build used here agrees to 0.996 cosine and loads in
 * a fraction of the time, which is what a cold start cares about.
 *
 * corpus_space.embedder names the model the vectors came from. A caller
 * compares it with EMBEDDER before searching: a query embedded by one model
 * into vectors made by another returns confident nonsense.
 */
export const EMBEDDER = "sentence-transformers/all-MiniLM-L6-v2";
const ONNX_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDER_DIMS = 384;

let loading: Promise<FeatureExtractionPipeline> | null = null;

function load(): Promise<FeatureExtractionPipeline> {
  if (loading) return loading;
  loading = (async () => {
    // Imported on first use, not at module load. Importing the package
    // dlopens ONNX Runtime's native library, and every route that touches
    // placement (the For Nerds page reads the model's vocabulary size from
    // it) would otherwise pay for that, or fail on it, before rendering a
    // word. Only a call that actually embeds text needs the runtime.
    const { env, pipeline } = await import("@huggingface/transformers");
    // The model files are fetched once per instance and cached. Serverless
    // filesystems are read-only outside /tmp.
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      env.cacheDir = "/tmp/transformers-cache";
    }
    return (await pipeline("feature-extraction", ONNX_MODEL, {
      dtype: "q8",
    })) as FeatureExtractionPipeline;
  })().catch((error) => {
    // A transient download failure must not disable search for the life of
    // the instance.
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
