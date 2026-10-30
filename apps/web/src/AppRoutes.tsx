import { OstraApp } from "@ostra/ui";
import { cacheFactory, openExternal } from "./platform.ts";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const WS_URL = API_BASE ? `${API_BASE.replace(/^http/, "ws")}/ws` : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export function AppRoutes() {
  return <OstraApp apiBase={API_BASE} wsUrl={WS_URL} cacheFactory={cacheFactory} openExternal={openExternal} />;
}
