const BASE = "http://paisa.invalid";

// Returns `path` if it points somewhere inside this app, otherwise "/".
// Guards the ?next= redirect after sign-in from sending the user to another site.
export function safeNextPath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/")) return "/";
  try {
    // Parsing like a browser catches tricks such as "//evil.com" or "/\evil.com".
    const url = new URL(path, BASE);
    if (url.origin !== BASE) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
