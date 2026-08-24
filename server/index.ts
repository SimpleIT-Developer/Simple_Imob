import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import {
  ensureAuditLogsInfrastructure,
  ensureInvoiceCategoryColumn,
  ensureLandlordNfseColumns,
  ensurePixTransferAttemptInfrastructure,
  ensureReceiptDiscountColumn,
} from "./db";
import { serveStatic } from "./static";
import { createServer } from "http";
import { nfseWorker } from "./services/nfseWorker";

// Force restart trigger
const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    await ensureReceiptDiscountColumn();
  } catch {}
  try {
    await ensureLandlordNfseColumns();
  } catch {}
  try {
    await ensureInvoiceCategoryColumn();
  } catch {}
  try {
    await ensurePixTransferAttemptInfrastructure();
  } catch {}
  try {
    await ensureAuditLogsInfrastructure();
  } catch {}
  await registerRoutes(httpServer, app);
  nfseWorker.start();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  
  httpServer.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n\nFATAL ERROR: Port ${port} is already in use.`);
      console.error(`Please close any other application using this port or kill the process using:`);
      console.error(`  netstat -ano | findstr :${port}`);
      console.error(`  taskkill /F /PID <PID>`);
      console.error(`\nOr wait a few seconds and try again.\n`);
      process.exit(1);
    } else {
      console.error("Server error:", e);
    }
  });

  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
