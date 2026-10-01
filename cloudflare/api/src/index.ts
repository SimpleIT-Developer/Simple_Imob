import { Container, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { buildContainerEnv, CONTAINER_PORT, isAllowedOrigin, toContainerRequest, type ApiSecrets } from "./forward";

type Env = ApiSecrets & {
  IMOB_SERVER: DurableObjectNamespace<ImobServer>;
  CORS_ORIGINS: string;
};

export class ImobServer extends Container<Env> {
  defaultPort = CONTAINER_PORT;
  sleepAfter = "15m";

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    this.envVars = buildContainerEnv(env);
  }
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) =>
  cors({
    origin: (origin) => (isAllowedOrigin(origin, c.env.CORS_ORIGINS) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Disposition"],
  })(c, next),
);

app.get("/health", (c) => c.json({ ok: true, worker: "imob-api" }));
app.all("/internal/*", (c) => c.notFound());

app.all("*", async (c) => {
  const container = getContainer(c.env.IMOB_SERVER, "main");
  const res = await container.fetch(toContainerRequest(c.req.raw, c.req.header("cf-connecting-ip") ?? null));
  // Resposta mutável para o middleware de CORS acrescentar cabeçalhos.
  return new Response(res.body, res);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const container = getContainer(env.IMOB_SERVER, "main");
    ctx.waitUntil(
      container
        .fetch(new Request("http://imob-server/internal/tick", { method: "POST", headers: { "x-internal-token": env.INTERNAL_TOKEN } }))
        .then(async (r) => {
          if (!r.ok) console.error("[cron] tick falhou", r.status, await r.text());
        })
        .catch((e) => console.error("[cron] tick erro", e)),
    );
  },
} satisfies ExportedHandler<Env>;
