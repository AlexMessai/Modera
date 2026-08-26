import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Telegram's login widget (both the legacy one and the current telegram-login.js)
  // talks to its own auth popup via window.opener -- a strict "same-origin" COOP
  // value blocks that cross-window messaging and the popup closes without ever
  // reporting back. "same-origin-allow-popups" keeps the isolation for same-origin
  // windows while still permitting that one cross-origin popup channel.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;
