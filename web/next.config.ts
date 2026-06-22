import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep axios + SDK on Node's native resolution (avoids bundled fetch failures).
  serverExternalPackages: ["@stellar/stellar-sdk", "axios"],
};

export default nextConfig;
