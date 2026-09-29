import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep a screen visited in the last 30 seconds, so going back to it is
    // instant. Every save calls revalidatePath("/", "layout"), which clears
    // this cache, so a screen never shows figures from before a save.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
