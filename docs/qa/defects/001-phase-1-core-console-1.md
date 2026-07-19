# Defect 001-phase-1-core-console-1

**Area:** backend
**Severity:** medium
**Status:** verified-fixed
**Spec:** `docs/specs/001-phase-1-core-console.md` — indirectly, acceptance criterion 1 (token auth) and the general startup contract in `docs/architecture.md` § Port strategy / § Security model.

## Resolution

Product owner ruled this in scope; fixed by backend-developer in
`src/server/index.ts`: after a successful `listen()`, the actual bound port
is now read back via `(candidateApp.server.address() as AddressInfo).port`
and propagated to both `state.port` and the `port`/`url` returned from
`startServer`, replacing the old `port = candidatePort` assignment.

**Re-verified by QA:**
- `npm run typecheck` / `npm run build` — both pass with the fix in place.
- `test/server/port-zero.test.ts` — both tests now **pass**:
  `server.port` matches the OS-assigned port, and a request to that real
  port with the correct token returns `200` (previously `401`).
- Manually re-ran the original reproduction script against the rebuilt
  `dist/`: `server.port` now equals the real bound port and `GET
  /api/status` returns `200`.

`test/helpers/server.ts`'s workaround (`server.state.port = actualPort`) is
now a no-op given the fix (the value it sets already matches), left in place
harmlessly rather than removed, since it doesn't affect correctness.

## Summary

`startServer({ port: 0 })` — the standard Node/Fastify idiom for "let the OS
assign an ephemeral port" — never reads back the port that was actually
bound. `server.port`, `server.url`, and `state.port` are left at the
*requested* port (`0`) instead of the real bound port. Because
`isAllowedHost` (the Host-header rebinding defense) compares the incoming
request's port against `state.port`, every request to the real (non-zero)
port is then rejected with `401 unauthorized` — the server is unusable when
started this way.

## Root cause (read, not modified)

`src/server/index.ts`, inside `startServer`'s port-resolution loop:

```ts
for (let attempt = 0; attempt < (strictPort ? 1 : MAX_PORT_ATTEMPTS); attempt++) {
  const candidatePort = desiredPort + attempt;
  state.port = candidatePort;
  const candidateApp = buildApp(state, webDist);
  try {
    await candidateApp.listen({ port: candidatePort, host: "127.0.0.1" });
    app = candidateApp;
    port = candidatePort;   // <-- bug: candidatePort, not the OS-assigned port
    break;
  } catch (err) { ... }
}
...
const url = `http://127.0.0.1:${port}/?token=${token}`;
```

When `candidatePort` is `0`, Node/Fastify listens and the OS assigns a real
port, but that real port is never read back from
`candidateApp.server.address()`. `port` (and the `state.port` set just above
the `listen()` call) stay `0`.

## Reproduction

```
node -e '
import("./dist/server/index.js").then(async ({ startServer }) => {
  const server = await startServer({ port: 0, strictPort: true, token: "t" });
  console.log("server.port:", server.port);                      // 0
  console.log("actual bound port:", server.app.server.address()); // real port, e.g. 51046
  const res = await fetch(`http://127.0.0.1:${server.app.server.address().port}/api/status`,
    { headers: { Authorization: "Bearer t" } });
  console.log("status:", res.status);                             // 401 — should be 200
  await server.close();
});
'
```

Output observed:
```
server.port: 0
actual bound port: { address: '127.0.0.1', family: 'IPv4', port: 51046 }
status: 401
```

## Automated regression test

`test/server/port-zero.test.ts` (2 tests, both currently fail):
- `server.port matches the OS-assigned port actually bound`
- `a request to the actual bound port, with the correct token, is accepted (not 401'd by a stale Host check)`

## Impact

1. A user running `traceriver start --port 0` (a reasonable, standard way to
   ask for "pick any free port") gets a console that rejects every request
   with 401, with no indication why — looks like a broken token, not a port
   bug.
2. This also blocks the standard "listen on an ephemeral port for a
   self-contained test" pattern against the real `startServer` API — QA's own
   test harness (`test/helpers/server.ts`) has to manually patch
   `server.state.port` after the fact to work around it, which isn't
   something a real consumer of `startServer` can/should have to do.

Note: the *existing*, documented auto-increment flow (default port 7580,
`--port` unset) is unaffected — `desiredPort` is never `0` in that path, so
`candidatePort` is never `0` either. This only manifests when a caller
explicitly requests port `0`.

## Suggested fix (for the backend-developer lane — not applied here)

After a successful `listen()`, read the real port back via
`(candidateApp.server.address() as AddressInfo).port` and use *that* for
`port`/`state.port`/the returned `url`, rather than trusting `candidatePort`.
