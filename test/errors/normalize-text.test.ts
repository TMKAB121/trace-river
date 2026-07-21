/**
 * Placeholder-normalization rules — docs/specs/004-phase-4-error-
 * intelligence.md § Interaction specs — Fingerprinting & grouping, step 2.
 * Unit-level coverage of each documented rule, independent of hashing —
 * the fingerprint golden tests (fingerprint-golden.test.ts) exercise these
 * rules in combination against realistic corpora; this file isolates each
 * rule so a regression here points straight at the offending pattern.
 */
import { describe, it, expect } from "vitest";
import { normalizeToTypedPlaceholders, normalizeAndRender } from "../../src/errors/normalize-text.js";

describe("normalizeAndRender — per-rule coverage", () => {
  it("ISO timestamp -> placeholder", () => {
    expect(normalizeAndRender("failed at 2026-07-19T09:14:01.442Z")).toBe("failed at ⟨…⟩");
  });

  it("date-only -> placeholder", () => {
    expect(normalizeAndRender("report for 2026-07-19 pending")).toBe("report for ⟨…⟩ pending");
  });

  it("UUID -> placeholder", () => {
    expect(normalizeAndRender("request 6ba7b810-9dad-11d1-80b4-00c04fd430c8 failed")).toBe(
      "request ⟨…⟩ failed",
    );
  });

  it("hex string >= 8 chars -> placeholder", () => {
    expect(normalizeAndRender("trace a1b2c3d4e5 failed")).toBe("trace ⟨…⟩ failed");
  });

  it("hex string < 8 chars is left alone (not enough entropy to be confidently an id)", () => {
    expect(normalizeAndRender("code a1b2c3 failed")).toBe("code a1b2c3 failed");
  });

  it("long bare integer (>= 6 digits) -> placeholder", () => {
    expect(normalizeAndRender("order 123456 shipped")).toBe("order ⟨…⟩ shipped");
  });

  it("short bare integer is left alone (conservative — avoids swallowing meaningful small numbers)", () => {
    expect(normalizeAndRender("retrying after 3 attempts")).toBe("retrying after 3 attempts");
  });

  it("quoted string literal -> placeholder", () => {
    expect(normalizeAndRender(`id = 'abc'`)).toBe("id = ⟨…⟩");
    expect(normalizeAndRender(`key "settings" missing`)).toBe("key ⟨…⟩ missing");
  });

  it("memory address -> placeholder", () => {
    expect(normalizeAndRender("segfault at 0x7ffeeb1a2c30")).toBe("segfault at ⟨…⟩");
  });

  it("duration -> placeholder", () => {
    expect(normalizeAndRender("request took 342ms")).toBe("request took ⟨…⟩");
    expect(normalizeAndRender("elapsed 1.5s")).toBe("elapsed ⟨…⟩");
  });

  it("port after a hostname-shaped token -> placeholder (port digits only, colon kept)", () => {
    expect(normalizeAndRender("connect to mysql:3306 failed")).toBe("connect to mysql:⟨…⟩ failed");
  });

  it("keyword-number position -> placeholder, keyword preserved", () => {
    expect(normalizeAndRender("user 12345 not found")).toBe("user ⟨…⟩ not found");
    expect(normalizeAndRender("request_id: 999999 timed out")).toBe("request_id: ⟨…⟩ timed out");
  });

  it("file path keeps its static tail, strips the user-specific prefix", () => {
    expect(normalizeToTypedPlaceholders("/Users/tsayge/project/app/Foo.php")).toBe("app/Foo.php");
  });

  it("Windows-style file path keeps its static tail", () => {
    expect(normalizeToTypedPlaceholders("C:\\Users\\tsayge\\project\\app\\Foo.php")).toBe("app\\Foo.php");
  });

  it("short (<=2 segment) path is left intact, not over-collapsed", () => {
    expect(normalizeToTypedPlaceholders("app/Foo.php")).toBe("app/Foo.php");
  });
});

describe("normalizeAndRender — conservative-by-design: does not over-normalize ordinary prose", () => {
  it("a plain English sentence with no variable-shaped content is untouched", () => {
    const text = "Undefined array key in UserController";
    expect(normalizeAndRender(text)).toBe(text);
  });

  it("does not eat meaningful short words/short numbers that merely sit near digits", () => {
    expect(normalizeAndRender("retry attempt 2 of 5")).toBe("retry attempt 2 of 5");
  });
});
