import axios, { AxiosError, type AxiosInstance } from "axios";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * Same-origin API client (an absolute base URL only inside the desktop
 * shell). Every request carries a fresh session token.
 */
export function createApi(baseURL: string, getToken: () => Promise<string | null>): AxiosInstance {
  const api = axios.create({ baseURL: `${baseURL}/api`, timeout: 30_000 });
  api.interceptors.request.use(async (config) => {
    const token = await getToken();
    if (token) config.headers.set("Authorization", `Bearer ${token}`);
    return config;
  });
  api.interceptors.response.use(
    (r) => r,
    (err: AxiosError<{ error?: string; code?: string }>) => {
      const status = err.response?.status ?? 0;
      const message = err.response?.data?.error ?? (status === 0 ? "You're offline." : "Something went wrong.");
      return Promise.reject(new ApiError(message, status, err.response?.data?.code));
    },
  );
  return api;
}

/** Streaming POST (AI writing). Yields text chunks as they arrive. */
export async function* streamText(baseURL: string, path: string, body: unknown, getToken: () => Promise<string | null>, signal?: AbortSignal): AsyncGenerator<string> {
  const token = await getToken();
  const res = await fetch(`${baseURL}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(data.error ?? "Something went wrong.", res.status, data.code);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (value) yield value;
  }
}
