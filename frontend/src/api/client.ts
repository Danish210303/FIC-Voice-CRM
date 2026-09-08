/**
 * Dynamic API Base URL Resolver.
 * Connects directly to the production Render backend API (https://ai-voice-agent-crm.onrender.com).
 */
const RENDER_PROD_URL = "https://ai-voice-agent-crm.onrender.com";

let currentBaseUrl: string | null = null;

export const getBaseUrl = (): string => {
  if (typeof localStorage !== "undefined") {
    const custom = localStorage.getItem("custom_api_url");
    if (custom && custom.trim() !== "") {
      return custom.trim().replace(/\/+$/, "");
    }
  }
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl && typeof envUrl === "string" && envUrl.trim() !== "") {
    return envUrl.trim().replace(/\/+$/, "");
  }
  return RENDER_PROD_URL;
};

export const setCustomApiUrl = (newUrl: string | null) => {
  if (typeof localStorage !== "undefined") {
    if (newUrl && newUrl.trim() !== "") {
      localStorage.setItem("custom_api_url", newUrl.trim().replace(/\/+$/, ""));
    } else {
      localStorage.removeItem("custom_api_url");
    }
  }
  currentBaseUrl = null;
};

const BASE_URL = getBaseUrl();

function getToken(): string | null {
  return localStorage.getItem("access_token");
}

export const getWsUrl = (roomPath: string = ""): string => {
  const token = getToken();
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
  let cleanPath = roomPath ? (roomPath.startsWith("/") ? roomPath : `/${roomPath}`) : "";
  while (cleanPath.startsWith("/ws/")) {
    cleanPath = cleanPath.substring(3);
  }
  if (cleanPath === "/ws") {
    cleanPath = "";
  }
  if (cleanPath && !cleanPath.startsWith("/")) {
    cleanPath = "/" + cleanPath;
  }
  const baseUrl = getBaseUrl();

  try {
    const urlObj = new URL(baseUrl);
    const wsProtocol = urlObj.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${urlObj.host}/ws${cleanPath}${tokenQuery}`;
  } catch {
    return `wss://ai-voice-agent-crm.onrender.com/ws${cleanPath}${tokenQuery}`;
  }
};

export const sanitizeUrl = (url: string): string => {
  if (!url) return "";
  return url.replace(/([?&]token=)[^&]+/g, "$1***");
};


export type ApiFetchOptions = RequestInit & {
  timeoutMs?: number;
  retries?: number;
};

/**
 * Robust fetch wrapper with authentication, timeout (default 35s for Render cold starts), retry logic, and centralized error parsing.
 * Always routes directly to Render API without falling back to local relative paths.
 */
export async function apiFetch(
  path: string,
  options: ApiFetchOptions = {},
  signal?: AbortSignal
): Promise<any> {
  const { timeoutMs = 35000, retries = 1, ...fetchOptions } = options;
  const token = getToken();

  const isPublicPath =
    path === "/health" ||
    path === "/api/health" ||
    path.startsWith("/api/auth/login") ||
    path.startsWith("/api/auth/bootstrap-admin") ||
    path.startsWith("/api/auth/refresh");

  if (!token && !isPublicPath) {
    // Only dispatch unauthorized if not already on login page
    if (typeof window !== "undefined" && !window.location.hash.includes("/login")) {
      window.dispatchEvent(new CustomEvent("auth:unauthorized"));
    }
    throw new Error("Session expired or authentication token missing.");
  }

  const headers: Record<string, string> = {
    ...(fetchOptions.body && !(fetchOptions.body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(fetchOptions.headers as Record<string, string>),
  };

  const baseUrl = getBaseUrl();
  const targetUrl = `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const combinedSignal = signal || controller.signal;

    try {
      const res = await fetch(targetUrl, {
        ...fetchOptions,
        headers,
        signal: combinedSignal,
      });

      clearTimeout(timeoutId);

      // Handle 401 Unauthorized safely: clear expired token and prompt login
      if (res.status === 401 && !isPublicPath) {
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem("access_token");
          localStorage.removeItem("user");
        }
        if (typeof window !== "undefined" && !window.location.hash.includes("/login")) {
          window.dispatchEvent(new CustomEvent("auth:unauthorized"));
          window.location.hash = "#/login";
        }
        const authErr = new Error("Session expired (401 Unauthorized). Please log in again.");
        authErr.name = "AuthError";
        throw authErr;
      }

      // Gracefully handle 403 Forbidden for active/live call polling on remote server
      if (res.status === 403 && (path.includes("/calls/active") || path.includes("/calls/live"))) {
        return [];
      }

      // Gracefully handle 404 Not Found for optional presence, session & shift-summary polling endpoints
      if (res.status === 404 && (path.includes("session") || path.includes("presence") || path.includes("shift-summary"))) {
        return null;
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: res.statusText }));
        let detailMsg = errorData.details || errorData.error || errorData.detail;
        if (Array.isArray(detailMsg)) {
          detailMsg = detailMsg.map((e: any) => e.msg || e.detail || e.details || JSON.stringify(e)).join("; ");
        } else if (typeof detailMsg === "object" && detailMsg !== null) {
          detailMsg = detailMsg.details || detailMsg.error || detailMsg.msg || detailMsg.detail || JSON.stringify(detailMsg);
        }
        const err = new Error(detailMsg || `Server returned error (${res.status})`);
        (err as any).status = res.status;
        (err as any).details = detailMsg;
        throw err;
      }

      return await res.json();
    } catch (err: any) {
      clearTimeout(timeoutId);

      // Don't retry if aborted explicitly by user, or if auth failed (401)
      if (err.name === "AbortError" && signal?.aborted) {
        throw err;
      }
      if (err.name === "AuthError") {
        throw err;
      }

      lastError = err;
      attempt++;

      if (attempt <= retries && err.name !== "AbortError" && err.name !== "AuthError") {
        // Exponential backoff before retry
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }

  const errorMessage =
    lastError?.name === "AbortError"
      ? "Render Server is spinning up (Cold Start). Please wait a few seconds and try again."
      : lastError?.message || "Unable to connect to the Render backend server. Please check your connection.";

  throw new Error(errorMessage);
}

export const api = {
  get: (path: string, signal?: AbortSignal) => apiFetch(path, {}, signal),
  post: (path: string, body?: unknown, signal?: AbortSignal) =>
    apiFetch(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }, signal),
  put: (path: string, body?: unknown, signal?: AbortSignal) =>
    apiFetch(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }, signal),
  patch: (path: string, body?: unknown, signal?: AbortSignal) =>
    apiFetch(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }, signal),
  delete: (path: string, signal?: AbortSignal) =>
    apiFetch(path, { method: "DELETE" }, signal),
  upload: (path: string, formData: FormData, signal?: AbortSignal) =>
    apiFetch(path, { method: "POST", body: formData }, signal),
  checkHealth: async (): Promise<{ status: string; database?: string }> => {
    try {
      return await apiFetch("/health", { timeoutMs: 35000, retries: 1 });
    } catch {
      return await apiFetch("/api/health", { timeoutMs: 35000, retries: 0 });
    }
  },
};

export { BASE_URL, getToken };
