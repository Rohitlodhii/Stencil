import type { NextConfig } from "next";

// EC2 backend host (server-side only — the browser never sees this URL).
// The browser talks same-origin HTTPS to /api/backend/* below, so there is
// no http:// mixed-content to block; Next.js proxies server-side to the
// gateway, which routes /auth/*, /exam/*, /chat, /upload-image, /config
// and /scanner/* (prefix stripped) to the right container.
const BACKEND_URL =
  process.env.BACKEND_URL ?? "http://13.203.224.137:8090";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: `${BACKEND_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
