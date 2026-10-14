import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const gatewayUrl = process.env.API_GATEWAY_URL ?? 'http://localhost:3500';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${gatewayUrl.replace(/\/$/, '')}/api/v1/:path*`,
      },
    ];
  },
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
