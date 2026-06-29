import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep axios + SDK on Node's native resolution (avoids bundled fetch failures).
  serverExternalPackages: ["@stellar/stellar-sdk", "axios"],
  // Next 16 blocks HMR when opened via 127.0.0.1 while dev server binds localhost.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
