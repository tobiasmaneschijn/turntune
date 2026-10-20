import { initializeBrowserObservability } from "./runtime";

export function startBrowserObservability() {
  return initializeBrowserObservability({
    target: window,
    testMode: import.meta.env?.MODE === "test",
    loadConfiguration: async () => {
      const response = await fetch("/api/config", {
        signal: AbortSignal.timeout(5_000), credentials: "omit", cache: "no-store",
        redirect: "error", headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("Monitoring configuration unavailable");
      return response.json();
    }
  });
}
