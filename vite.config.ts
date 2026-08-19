import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const isProd = process.env.NODE_ENV === "production";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "esnext",
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-codemirror": [
            "codemirror",
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/lang-javascript",
            "@codemirror/lang-rust",
          ],
          "vendor-xterm": ["@xterm/xterm", "@xterm/addon-fit"],
          "vendor-markdown": ["react-markdown", "remark-gfm"],
          "vendor-three": ["three"],
        },
      },
    },
  },
  esbuild: {
    drop: isProd ? ["console", "debugger"] : [],
    legalComments: "none",
  },
}));
