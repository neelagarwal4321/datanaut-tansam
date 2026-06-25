const hostname =
  typeof window !== "undefined"
    ? window.location.hostname === "localhost"
      ? "127.0.0.1"
      : window.location.hostname
    : "127.0.0.1";

const protocol = typeof window !== "undefined" ? window.location.protocol : "http:";

export const BACKEND_URL =
  import.meta.env?.VITE_BACKEND_URL ??
  `${protocol}//${hostname}:8085`;

export const WS_URL =
  import.meta.env?.VITE_WS_URL ??
  `${protocol === "https:" ? "wss:" : "ws:"}//${hostname}:8085`;

// WS URL with API key appended as query param for server-side auth.
const _wsApiKey = import.meta.env?.VITE_API_SECRET ?? "";
export const WS_URL_WITH_AUTH = _wsApiKey
  ? `${WS_URL}?api_key=${encodeURIComponent(_wsApiKey)}`
  : WS_URL;
