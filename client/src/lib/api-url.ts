export function resolveApiUrl(path: string, base: string): string {
  if (!base) return path;
  const isApi = path === "/api" || path.startsWith("/api/") || path.startsWith("/api?");
  return isApi ? base.replace(/\/+$/, "") + path : path;
}
