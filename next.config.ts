import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The floating dev badge sits on top of the sidebar's sync-status footer.
  devIndicators: false,
};

export default nextConfig;
