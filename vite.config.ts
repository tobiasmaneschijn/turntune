import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("@base-ui")) return "base-ui";
          if (id.includes("socket.io") || id.includes("engine.io")) return "realtime";
          if (id.includes("emoji-picker-react") || id.includes("@twemoji")) return "emoji";
          if (id.includes("lucide-react")) return "icons";
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (id.includes("react-resizable-panels")) return "resizable";
        }
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    // Generated traces/captures must not reload a different browser's room.
    watch: { ignored: ["**/work/**", "**/test-results/**", "**/test-results-*/**", "**/test-results-*.png", "**/playwright-report/**"] },
    proxy: {
      "/socket.io": {
        target: process.env.SOUNDSPIN_API_TARGET || "http://127.0.0.1:3000",
        ws: true
      },
      "/api": process.env.SOUNDSPIN_API_TARGET || "http://127.0.0.1:3000"
    }
  }
});
