import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const API = process.env.OSTRA_API_URL ?? "http://localhost:8787";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // One set of env files at the repo root for the API and the app. `clerk env pull` writes the
  // publishable key without the VITE_ prefix; it's public by design, the secret key never matches.
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  envPrefix: ["VITE_", "CLERK_PUBLISHABLE_KEY"],
  // The desktop build talks to the hosted API unless told otherwise.
  define:
    mode === "desktop" && !process.env.VITE_API_URL
      ? { "import.meta.env.VITE_API_URL": JSON.stringify(process.env.OSTRA_DESKTOP_API_URL ?? "https://app.heyostra.com") }
      : {},
  // Absolute paths: deep links like /sign-in/factor-one must resolve assets from the root (Tauri serves from / too).
  base: "/",
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/ws": { target: API.replace(/^http/, "ws"), ws: true },
    },
  },
  // `vite preview` (e2e) proxies to the API like the dev server does.
  preview: {
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/ws": { target: API.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: mode !== "desktop",
    rollupOptions: {
      output: {
        // Framework code changes rarely; keep it in its own long-cached chunk.
        manualChunks: { react: ["react", "react-dom", "react-router"] },
      },
    },
  },
}));
