import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      // SSE endpoint — disable proxy timeout and suppress normal close errors
      "/api/events": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("error", (_err, _req, res) => {
            // SSE connections close normally when the client navigates away;
            // swallow the error so Vite doesn't log it as a proxy failure.
            try {
              if (!("headersSent" in res && (res as { headersSent: boolean }).headersSent)) {
                (res as { end(): void }).end();
              }
            } catch {
              /* already closed */
            }
          });
        },
      },
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
