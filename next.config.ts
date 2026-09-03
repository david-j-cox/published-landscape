import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The embedder ships native ONNX binaries that must be required at runtime,
  // not bundled.
  serverExternalPackages: ["postgres", "@huggingface/transformers", "onnxruntime-node"],
  // File tracing follows the require() of onnxruntime_binding.node but not
  // the libonnxruntime.so.1 that binding dlopens from the same directory, so
  // a Vercel function got the addon without its runtime and every import of
  // the embedder failed with "cannot open shared object file" (2026-09-03).
  // Ship the whole Linux x64 directory alongside the route that embeds.
  outputFileTracingIncludes: {
    "/api/place": ["node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**/*"],
  },
};

export default nextConfig;
