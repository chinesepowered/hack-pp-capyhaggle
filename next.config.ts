import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PayPal Agent Toolkit and its axios instance are loaded from node_modules at runtime so that
  // lib/paypal/toolkit.ts can attach one response interceptor and log every toolkit call.
  serverExternalPackages: ["@paypal/agent-toolkit", "axios"],
  // Files read with fs at runtime must be traced into the serverless functions.
  outputFileTracingIncludes: {
    "/api/**": ["./fixtures/**/*"],
    "/api/listings/draft": ["./public/items/**/*"],
  },
  images: { unoptimized: true },
  // No generated AGENTS.md in this repo.
  agentRules: false,
  devIndicators: false,
};

export default nextConfig;
