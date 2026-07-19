/**
 * Session token handling — spec 001 § API contract § Auth.
 *
 * The SPA shell itself carries no data and is served without a token check.
 * On load, the SPA reads `token` from the URL query string into an
 * in-memory singleton (not localStorage — no reason to persist a per-run
 * secret to disk). A plain browser refresh still works because the token
 * remains in the URL's query string across reload.
 */

const params = new URLSearchParams(window.location.search);

/** In-memory singleton — read once at module init, never persisted. */
export const token: string | null = params.get("token");

export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
