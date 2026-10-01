import { resolveApiUrl } from "./api-url";

const API_BASE: string = import.meta.env.VITE_API_URL ?? "";

export function apiUrl(path: string): string {
  return resolveApiUrl(path, API_BASE);
}

export function absoluteApiUrl(path: string): string {
  return new URL(apiUrl(path), window.location.origin).toString();
}

// Com a API em outro host, todo fetch("/api/...") do app vai para VITE_API_URL levando o cookie de sessão.
export function installApiFetch(): void {
  if (!API_BASE) return;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") {
      const resolved = resolveApiUrl(input, API_BASE);
      if (resolved !== input) return original(resolved, { ...init, credentials: "include" });
    }
    return original(input, init);
  };
}
