/**
 * Puts the query embedder's weights in models/ before a build.
 *
 * src/lib/embed.ts loads trellis-minilm-cite from models/ at request time,
 * and next.config.ts traces that directory into the function that embeds. The
 * weights are a fine-tune of all-MiniLM-L6-v2 on the corpus's citation graph,
 * trained in the Trellis repository and published nowhere -- and this
 * repository is public, so they are not in git. They arrive here instead:
 *
 *   EMBEDDER_MODEL_URL     a .tar.gz of the trellis-minilm-cite directory
 *   EMBEDDER_MODEL_TOKEN   optional; sent as a bearer token
 *
 * Both are build-time variables on Vercel. A laptop with the Trellis checkout
 * beside this one needs neither: link the directory instead,
 *
 *   ln -s ../../writers-trellis/models/trellis-minilm-cite models/trellis-minilm-cite
 *
 * Whatever put the files there, the weights are checked against the hash of
 * the model the corpus was embedded with. A query embedded by a different
 * model into these vectors returns confident nonsense rather than an error,
 * so a mismatch fails the build. When the corpus is re-embedded, this hash
 * and EMBEDDER in embed.ts change together.
 *
 * Without a URL and without the files the build goes on -- `next build` does
 * not need the model, and CI runs it as a check -- except on Vercel, where a
 * deployment without the weights would answer every placement with an error.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MODEL = "trellis-minilm-cite";
// sha256 of onnx/model.onnx for trellis/all-MiniLM-L6-v2-cite-r5.
const WEIGHTS_SHA256 = "86cd8605f174400fe4d44314febf706536583a6e536966f15598713bef6cf621";

const root = process.cwd();
const modelsDir = path.join(root, "models");
const weights = path.join(modelsDir, MODEL, "onnx", "model.onnx");

async function present() {
  try {
    return (await stat(weights)).isFile();
  } catch {
    return false;
  }
}

async function verify() {
  const digest = createHash("sha256").update(await readFile(weights)).digest("hex");
  if (digest !== WEIGHTS_SHA256) {
    throw new Error(
      `models/${MODEL}/onnx/model.onnx is not the model the corpus was embedded with ` +
        `(sha256 ${digest.slice(0, 12)}..., expected ${WEIGHTS_SHA256.slice(0, 12)}...). ` +
        `Either the weights are stale or src/lib/embed.ts and this script name different models.`,
    );
  }
}

async function download(url, token) {
  const headers = { Accept: "application/octet-stream" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`EMBEDDER_MODEL_URL answered ${res.status} ${res.statusText}`);
  }
  const dir = await mkdtemp(path.join(tmpdir(), "embedder-"));
  const archive = path.join(dir, "model.tar.gz");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(archive));
  await mkdir(modelsDir, { recursive: true });
  // The archive holds the directory itself: trellis-minilm-cite/onnx/model.onnx
  // and the tokenizer files beside it, as `tar czf model.tar.gz -C models
  // trellis-minilm-cite` makes it.
  execFileSync("tar", ["-xzf", archive, "-C", modelsDir], { stdio: "inherit" });
  await rm(dir, { recursive: true, force: true });
  if (!(await present())) {
    throw new Error(`the archive did not contain ${MODEL}/onnx/model.onnx`);
  }
}

const url = process.env.EMBEDDER_MODEL_URL;
if (await present()) {
  await verify();
  console.log(`[fetch-model] models/${MODEL} is present and is the corpus's model.`);
} else if (url) {
  console.log(`[fetch-model] downloading ${MODEL}...`);
  await download(url, process.env.EMBEDDER_MODEL_TOKEN);
  await verify();
  const { size } = await stat(weights);
  console.log(`[fetch-model] models/${MODEL} ready, ${(size / 1e6).toFixed(0)} MB, hash verified.`);
} else if (process.env.VERCEL) {
  throw new Error(
    `[fetch-model] models/${MODEL} is missing and EMBEDDER_MODEL_URL is not set. ` +
      `A deployment without the weights fails every placement; set the variable for this environment.`,
  );
} else {
  console.log(
    `[fetch-model] models/${MODEL} is missing and EMBEDDER_MODEL_URL is not set; ` +
      `the build goes on, but placement will fail until the weights are here. See scripts/fetch-model.mjs.`,
  );
}
