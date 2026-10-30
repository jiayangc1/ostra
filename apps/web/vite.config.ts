import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API = process.env.OSTRA_API_URL ?? "http://localhost:8787";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
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
  build: {
    target: "es2022",
    sourcemap: mode !== "desktop",
  },
}));
