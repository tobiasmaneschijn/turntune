import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "@fontsource-variable/geist";
import { App } from "./app/App";
import { AppErrorBoundary } from "./app/components/AppErrorBoundary";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import "./styles/shadcn.css";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
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
