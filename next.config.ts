import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The embedder ships native ONNX binaries that must be required at runtime,
  // not bundled.
  serverExternalPackages: ["postgres", "@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
