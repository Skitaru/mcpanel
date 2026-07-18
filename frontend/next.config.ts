import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proxy /api/* and /socket.io/* to the backend so the frontend can use
  // same-origin requests — no CORS, no hardcoded IPs.
  async rewrites() {
    const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
      {
        source: "/socket.io/:path*",
        destination: `${backend}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
