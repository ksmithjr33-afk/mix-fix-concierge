import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // forbidden(): the Scorecard pages answer 403 to anyone but admins and managers.
  experimental: { authInterrupts: true },
};

export default nextConfig;
