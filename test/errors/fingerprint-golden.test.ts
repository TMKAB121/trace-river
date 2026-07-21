/**
 * Fingerprint golden tests — docs/phases/phase-4-error-intelligence.md § 4.4
 * ("fixture corpus of real error messages (Laravel exceptions, mysql
 * errors, nginx 5xx, Node unhandled rejections) -> expected group
 * assignments") and docs/specs/004-phase-4-error-intelligence.md acceptance
 * criteria 1, 2, 7.
 *
 * Exercises `computeFingerprint` directly (the pure algorithm) against a
 * real-world-shaped corpus, one section per source ecosystem. Per the
 * spec's own stated bias ("false merges... worse than false splits"), each
 * section explicitly asserts both directions:
 *   - repeated occurrences of the *same* underlying bug (differing only in
 *     variable content: request ids, user ids, timestamps, ports, durations)
 *     collapse to the *same* fingerprint;
 *   - two textually-similar but distinct bugs (different top stack frame,
 *     or a different source id for the literal same message) never merge.
 */
import { describe, it, expect } from "vitest";
import { computeFingerprint, extractTopStackFrame } from "../../src/errors/fingerprint.js";

function fp(input: { source: string; level: "ERROR" | "FATAL"; message: string; body?: string | null }) {
  return computeFingerprint({ source: input.source, level: input.level, message: input.message, body: input.body ?? null });
}

describe("Fingerprint golden corpus — Laravel exceptions", () => {
  const bodyFor = (reqId: string, userId: number) =>
    [
      `production.ERROR: Undefined array key "id" in /app/app/Http/Controllers/UserController.php:42`,
      `#0 /app/app/Http/Controllers/UserController.php(42): App\\Http\\Controllers\\UserController->show()`,
      `#1 /app/vendor/laravel/framework/src/Illuminate/Routing/Controller.php(54): call_user_func_array()`,
      `#2 {main}`,
      `request_id ${reqId} user ${userId}`,
    ].join("\n");

  it("400 occurrences of the same exception (varying request/user ids) all fingerprint identically", () => {
    const fingerprints = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const result = fp({
        source: "docker:app",
        level: "ERROR",
        message: `Undefined array key "id" in UserController.php:42`,
        body: bodyFor(`req-${1000 + i}-${"a1b2c3d4"}`, 10000 + i),
      });
      expect(result).not.toBeNull();
      fingerprints.add(result!.fingerprint);
    }
    expect(fingerprints.size).toBe(1);
  });

  it("a second exception with the same message but a different top stack frame (different file/line) fingerprints differently", () => {
    const first = fp({
      source: "docker:app",
      level: "ERROR",
      message: `Undefined array key "id" in UserController.php:42`,
      body: bodyFor("req-1", 1),
    });
    const second = fp({
      source: "docker:app",
      level: "ERROR",
      message: `Undefined array key "id" in UserController.php:42`,
      body: [
        `production.ERROR: Undefined array key "id" in UserController.php:42`,
        `#0 /app/app/Services/ReportBuilder.php(88): App\\Services\\ReportBuilder->build()`,
        `#1 {main}`,
      ].join("\n"),
    });
    expect(first!.fingerprint).not.toBe(second!.fingerprint);
  });

  it("title renders the placeholder glyph, never a literal secret/variable value", () => {
    const result = fp({
      source: "docker:app",
      level: "ERROR",
      message: `Undefined array key "id" in UserController.php:42`,
      body: bodyFor("req-9", 9),
    });
    expect(result!.title).toContain("⟨…⟩");
    expect(result!.title).not.toContain("req-9");
  });
});

describe("Fingerprint golden corpus — mysql errors", () => {
  it("repeated 'Connection refused' occurrences (varying only timestamp/port) fingerprint identically", () => {
    const a = fp({
      source: "docker:mysql",
      level: "FATAL",
      message: "2026-07-19T09:14:01.442Z [ERROR] mysqld: Connection refused: mysql:3306",
    });
    const b = fp({
      source: "docker:mysql",
      level: "FATAL",
      message: "2026-07-19T09:14:03.918Z [ERROR] mysqld: Connection refused: mysql:3306",
    });
    const c = fp({
      source: "docker:mysql",
      level: "FATAL",
      message: "2026-07-19T09:29:47.001Z [ERROR] mysqld: Connection refused: mysql:3306",
    });
    expect(a!.fingerprint).toBe(b!.fingerprint);
    expect(b!.fingerprint).toBe(c!.fingerprint);
  });

  it("a distinct mysql error (table doesn't exist) fingerprints differently from connection-refused", () => {
    const connRefused = fp({
      source: "docker:mysql",
      level: "FATAL",
      message: "Connection refused: mysql:3306",
    });
    const tableMissing = fp({
      source: "docker:mysql",
      level: "ERROR",
      message: "Table 'app_production.orders' doesn't exist",
    });
    expect(connRefused!.fingerprint).not.toBe(tableMissing!.fingerprint);
  });

  it("the identical message from a different source id (docker:mysql vs docker:mysql-replica) never merges (Decision 1 — literal source id namespace)", () => {
    const primary = fp({ source: "docker:mysql", level: "FATAL", message: "Connection refused: mysql:3306" });
    const replica = fp({ source: "docker:mysql-replica", level: "FATAL", message: "Connection refused: mysql:3306" });
    expect(primary!.fingerprint).not.toBe(replica!.fingerprint);
  });
});

describe("Fingerprint golden corpus — nginx 5xx", () => {
  // `message` here is post-parse content (docs/log-schema.md / src/parsers/
  // formats/clf.ts's error-log branch already strips the leading
  // "[timestamp] [level] [client x]" bracket groups before fingerprinting
  // ever sees the text — see src/parsers/formats/clf.ts ERROR_RE), so these
  // fixtures deliberately omit that prefix and vary only fields the spec's
  // normalization rules actually cover (a quoted upstream URL, a duration).
  it("repeated 502s against the same upstream (varying only the request-duration figure) fingerprint identically", () => {
    const a = fp({
      source: "docker:nginx",
      level: "ERROR",
      message: 'connect() failed (111: Connection refused) while connecting to upstream, upstream: "http://172.18.0.9:9000/", took 12ms',
    });
    const b = fp({
      source: "docker:nginx",
      level: "ERROR",
      message: 'connect() failed (111: Connection refused) while connecting to upstream, upstream: "http://172.18.0.9:9000/", took 340ms',
    });
    expect(a!.fingerprint).toBe(b!.fingerprint);
  });

  it("a 500 from a different upstream path fingerprints differently from the 502 above", () => {
    const upstreamDown = fp({
      source: "docker:nginx",
      level: "ERROR",
      message: '[error] connect() failed (111: Connection refused) while connecting to upstream, upstream: "http://172.18.0.9:9000/"',
    });
    const scriptError = fp({
      source: "docker:nginx",
      level: "ERROR",
      message: 'FastCGI sent in stderr: "PHP message: PHP Fatal error:  Uncaught TypeError" while reading response header from upstream',
    });
    expect(upstreamDown!.fingerprint).not.toBe(scriptError!.fingerprint);
  });
});

describe("Fingerprint golden corpus — Node unhandled rejections", () => {
  const bodyFor = (id: string) =>
    [
      "UnhandledPromiseRejectionWarning: Error: connect ECONNREFUSED 127.0.0.1:5432",
      `    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1494:16)`,
      `    request-id=${id}`,
    ].join("\n");

  it("repeated unhandled rejections (varying request id) fingerprint identically", () => {
    const a = fp({
      source: "docker:api",
      level: "ERROR",
      message: "UnhandledPromiseRejectionWarning: Error: connect ECONNREFUSED 127.0.0.1:5432",
      body: bodyFor("a1b2c3d4e5"),
    });
    const b = fp({
      source: "docker:api",
      level: "ERROR",
      message: "UnhandledPromiseRejectionWarning: Error: connect ECONNREFUSED 127.0.0.1:5432",
      body: bodyFor("f6a7b8c9d0"),
    });
    expect(a!.fingerprint).toBe(b!.fingerprint);
  });

  it("an unhandled rejection at a different call site (different top stack frame) fingerprints differently", () => {
    const a = fp({
      source: "docker:api",
      level: "ERROR",
      message: "UnhandledPromiseRejectionWarning: Error: connect ECONNREFUSED 127.0.0.1:5432",
      body: bodyFor("id-1"),
    });
    const b = fp({
      source: "docker:api",
      level: "ERROR",
      message: "UnhandledPromiseRejectionWarning: Error: connect ECONNREFUSED 127.0.0.1:5432",
      body: [
        "UnhandledPromiseRejectionWarning: Error: connect ECONNREFUSED 127.0.0.1:5432",
        "    at Pool.query (/app/node_modules/pg/lib/pool.js:45:11)",
      ].join("\n"),
    });
    expect(a!.fingerprint).not.toBe(b!.fingerprint);
  });
});

describe("Cross-ecosystem — never false-merge across unrelated error types/sources", () => {
  it("Laravel, mysql, nginx, and Node fixtures above are all pairwise distinct fingerprints", () => {
    const samples = [
      fp({ source: "docker:app", level: "ERROR", message: `Undefined array key "id" in UserController.php:42` }),
      fp({ source: "docker:mysql", level: "FATAL", message: "Connection refused: mysql:3306" }),
      fp({ source: "docker:nginx", level: "ERROR", message: '[error] connect() failed (111: Connection refused) while connecting to upstream' }),
      fp({ source: "docker:api", level: "ERROR", message: "UnhandledPromiseRejectionWarning: Error: connect ECONNREFUSED 127.0.0.1:5432" }),
    ].map((r) => r!.fingerprint);
    expect(new Set(samples).size).toBe(samples.length);
  });
});

describe("entry.fingerprint is non-null only for ERROR/FATAL (criterion 7)", () => {
  it("returns null for DEBUG/INFO/WARN/UNKNOWN even with an error-shaped message", () => {
    for (const level of ["DEBUG", "INFO", "WARN", "UNKNOWN"] as const) {
      const result = computeFingerprint({ source: "docker:app", level, message: "Connection refused: mysql:3306", body: null });
      expect(result).toBeNull();
    }
  });

  it("returns non-null for ERROR and FATAL", () => {
    for (const level of ["ERROR", "FATAL"] as const) {
      const result = computeFingerprint({ source: "docker:app", level, message: "Connection refused: mysql:3306", body: null });
      expect(result).not.toBeNull();
    }
  });
});

describe("extractTopStackFrame", () => {
  it("skips body's first line (duplicate of message) and finds the first PHP frame", () => {
    const body = ["production.ERROR: boom", "#0 /app/Foo.php(1): bar()", "#1 {main}"].join("\n");
    expect(extractTopStackFrame(body)).toBe("#0 /app/Foo.php(1): bar()");
  });

  it("finds the first Node 'at ...' frame", () => {
    const body = ["Error: boom", "    at Object.<anonymous> (/app/index.js:1:1)"].join("\n");
    expect(extractTopStackFrame(body)).toBe("at Object.<anonymous> (/app/index.js:1:1)");
  });

  it("finds the first Python 'File \"...\"' frame", () => {
    const body = ['Traceback boom', 'File "app.py", line 10, in <module>'].join("\n");
    expect(extractTopStackFrame(body)).toBe('File "app.py", line 10, in <module>');
  });

  it("returns null for a null body, and falls back to the first non-blank continuation line otherwise", () => {
    expect(extractTopStackFrame(null)).toBeNull();
    const body = ["message", "", "  some unrecognized continuation  "].join("\n");
    expect(extractTopStackFrame(body)).toBe("some unrecognized continuation");
  });
});
