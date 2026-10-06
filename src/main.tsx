import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import "./shadcn.css";
import "./styles.css";

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
