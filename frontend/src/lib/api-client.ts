import type { ApiErrorResponse } from "@ai-sales/shared";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function buildUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? safeJsonParse(text) : undefined;

  if (!res.ok) {
    const errBody = body as ApiErrorResponse | undefined;
    const message =
      errBody?.error?.message ??
      `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message, errBody?.error?.details);
  }

  return body as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path), {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Accept: "application/json",
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      "Could not reach the server. Check your connection and try again."
    );
  }
  return parseResponse<T>(res);
}

export function apiGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const query = buildQueryString(params);
  return request<T>(`${path}${query}`, { method: "GET" });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "DELETE",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Multipart upload helper (e.g. CSV import). Does not set Content-Type manually
 * so the browser can add the correct multipart boundary. */
export async function apiUpload<T>(
  path: string,
  file: File,
  fieldName = "file"
): Promise<T> {
  const formData = new FormData();
  formData.append(fieldName, file);

  let res: Response;
  try {
    res = await fetch(buildUrl(path), {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
      body: formData,
    });
  } catch {
    throw new ApiError(
      0,
      "Could not reach the server. Check your connection and try again."
    );
  }
  return parseResponse<T>(res);
}

function buildQueryString(params?: Record<string, unknown>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
