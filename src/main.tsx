import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import { App } from "./app/App";
import { AppErrorBoundary } from "./app/components/AppErrorBoundary";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { telemetry } from "../shared/observability";
import { startBrowserObservability } from "./lib/observability";
import "./styles/shadcn.css";
import "./styles/index.css";

const monitoring = startBrowserObservability();
if (import.meta.hot) import.meta.hot.dispose(() => monitoring.dispose());

createRoot(document.getElementById("root")!, {
  onUncaughtError: error => telemetry.captureError(error, { operation: "browser.render.uncaught" }),
  // Error boundaries report caught exceptions with their fixed operation names.
  onCaughtError: () => {},
  onRecoverableError: error => telemetry.captureError(error, { operation: "browser.render.recoverable" })
}).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delay={350}>
        <AppErrorBoundary>
          <App />
          <Toaster position="bottom-center" />
        </AppErrorBoundary>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
);
