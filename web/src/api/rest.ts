import { authHeaders, token } from "./auth";
import type { SourceDescriptor, StatusResponse, TraceRiverLog } from "../types";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`API error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // response wasn't JSON — leave body null
    }
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

export function getStatus(): Promise<StatusResponse> {
  return apiFetch<StatusResponse>("/api/status");
}

export function getSources(): Promise<{ sources: SourceDescriptor[] }> {
  return apiFetch<{ sources: SourceDescriptor[] }>("/api/sources");
}

export function getReplay(after: number): Promise<{ entries: TraceRiverLog[] }> {
  return apiFetch<{ entries: TraceRiverLog[] }>(`/api/replay?after=${encodeURIComponent(after)}`);
}

export interface UploadHandle {
  xhr: XMLHttpRequest;
  promise: Promise<{ source: SourceDescriptor }>;
  abort: () => void;
}

/**
 * Streaming upload — POST /api/upload?name=<url-encoded filename>.
 * Raw bytes as the body, no multipart (spec 001 § API contract). Uses
 * XMLHttpRequest rather than fetch so we get `upload.onprogress` events for
 * the client-side byte-progress bar (fetch has no cross-browser upload
 * progress API).
 */
export function uploadFile(
  file: File,
  onProgress: (loadedBytes: number, totalBytes: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<{ source: SourceDescriptor }>((resolve, reject) => {
    xhr.open("POST", `/api/upload?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        onProgress(evt.loaded, evt.total);
      }
    };

    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // fall through with null body
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as { source: SourceDescriptor });
      } else {
        reject(new ApiError(xhr.status, body));
      }
    };

    xhr.onerror = () => reject(new Error("network_error"));
    xhr.onabort = () => reject(new Error("aborted"));

    xhr.send(file);
  });

  return { xhr, promise, abort: () => xhr.abort() };
}
