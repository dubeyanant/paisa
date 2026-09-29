import type { MetadataRoute } from "next";

// Lets the owner add Paisa to the phone's home screen and open it like an app
// (NFR-2). src/proxy.ts lets this file through without signing in, because
// browsers fetch it without cookies.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Paisa",
    short_name: "Paisa",
    description: "Personal finance insights dashboard",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f6f3",
    theme_color: "#f6f6f3",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
