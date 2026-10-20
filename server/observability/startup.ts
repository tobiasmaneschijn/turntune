import { initializeObservability, installFatalErrorReporting } from "./bootstrap.js";
import { telemetry, flushTelemetry } from "./index.js";

export async function startServer(load: () => Promise<unknown>) {
  await initializeObservability();
  try { await load(); }
  catch (error) {
    telemetry.captureError(error, { operation: "server.startup" });
    // Configuration names aid operators without echoing environment values or
    // arbitrary provider/database errors through Node's uncaught-error renderer.
    if (error instanceof Error && typeof error.message === "string") {
      const setting = ["SUPABASE_JWKS", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "APP_ORIGIN", "TRUSTED_PROXY_CIDRS", "PROVIDER_TOKEN_ENCRYPTION_KEY"].find(name => error.message.includes(name));
      if (setting) console.error(JSON.stringify({ type: "application", level: "error", event: "server.startup.configuration_rejected", setting }));
    }
    await flushTelemetry();
    process.exit(1);
  }
  installFatalErrorReporting();
}
