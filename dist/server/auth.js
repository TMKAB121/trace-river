/**
 * Auth & rebinding-defense helpers. See docs/architecture.md § "Security
 * model" and docs/specs/001-phase-1-core-console.md § "Auth".
 */
const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
/** Host header must be 127.0.0.1:<port> or localhost:<port> — second layer against DNS rebinding. */
export function isAllowedHost(hostHeader, port) {
    if (!hostHeader)
        return false;
    const [hostname, portStr] = splitHostPort(hostHeader);
    if (!ALLOWED_HOSTNAMES.has(hostname))
        return false;
    const headerPort = portStr ? Number(portStr) : defaultPortFor(hostname);
    return headerPort === port;
}
/** Origin header (when present — WS upgrades and browser requests both send one) must match too. */
export function isAllowedOrigin(originHeader, port) {
    if (!originHeader)
        return true; // non-browser clients (curl, tests) send no Origin — Host check still applies.
    try {
        const url = new URL(originHeader);
        if (!ALLOWED_HOSTNAMES.has(url.hostname))
            return false;
        const originPort = url.port ? Number(url.port) : defaultPortFor(url.hostname);
        return originPort === port;
    }
    catch {
        return false;
    }
}
function splitHostPort(hostHeader) {
    // IPv6 literals aren't in scope (we only ever bind 127.0.0.1), so a plain split is safe.
    const idx = hostHeader.lastIndexOf(":");
    if (idx === -1)
        return [hostHeader, undefined];
    return [hostHeader.slice(0, idx), hostHeader.slice(idx + 1)];
}
function defaultPortFor(_hostname) {
    return 80;
}
/** Extracts a bearer token from `Authorization: Bearer <token>`. */
export function extractBearerToken(authHeader) {
    if (!authHeader)
        return undefined;
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match?.[1];
}
//# sourceMappingURL=auth.js.map