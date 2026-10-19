import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const testPort=process.argv[process.argv.indexOf("--port")+1];
const testCacheKey=/^\d{2,5}$/.test(testPort??"")?testPort:"default";

function fixtureApiGuard(): Plugin {
  return {name:"soundspin-test-api-guard",configureServer(server){
    server.middlewares.use((request,response,next)=>{
      const pathname=request.url?.split("?")[0]??"";
      if(pathname==="/api"||pathname.startsWith("/api/")||pathname==="/socket.io"||pathname.startsWith("/socket.io/")){
        response.statusCode=503;
        response.setHeader("Content-Type","application/json");
        response.setHeader("Cache-Control","no-store");
        response.end(JSON.stringify({error:"Local browser fixtures must mock API and socket requests."}));
        return;
      }
      next();
    });
  }};
}

export default defineConfig(({mode})=>({
  // Mocked browser suites must never load a developer's connected credentials.
  envDir: mode === "test" ? path.resolve(__dirname,"tests/config/env") : __dirname,
  envPrefix: mode === "test" ? "SOUNDSPIN_TEST_PUBLIC_" : "VITE_",
  cacheDir:mode==="test"?path.resolve(__dirname,"work",`vite-test-${testCacheKey}`):undefined,
  optimizeDeps:mode==="test"?{entries:["index.html","tests/**/*.html"]}:undefined,
  plugins: [react(), tailwindcss(),...(mode==="test"?[fixtureApiGuard()]:[])],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("@base-ui")) return "base-ui";
          if (id.includes("socket.io") || id.includes("engine.io")) return "realtime";
          if (id.includes("emoji-picker-react")) return "emoji-picker";
          if (id.includes("@twemoji")) return "emoji-text";
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
    hmr:mode==="test"?false:undefined,
    host: "127.0.0.1",
    port: 5173,
    // Generated traces/captures must not reload a different browser's room.
    watch: { ignored: ["**/work/**", "**/test-results/**", "**/test-results-*/**", "**/test-results-*.png", "**/playwright-report/**"] },
    // Test fixtures never forward a forgotten mock to a user's running app.
    proxy: mode==="test"?undefined:{
      "/socket.io": {
        target: process.env.SOUNDSPIN_API_TARGET || "http://127.0.0.1:3000",
        ws: true
      },
      "/api": process.env.SOUNDSPIN_API_TARGET || "http://127.0.0.1:3000"
    }
  }
}));
