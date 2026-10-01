type Env = { ASSETS: Fetcher; API: Fetcher };

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/") || pathname.startsWith("/webhook/")) {
      return env.API.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
