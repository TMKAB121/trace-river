import { randomBytes, timingSafeEqual } from "node:crypto";

/** Crypto-random, 128-bit session token generated once per CLI run. */
export function generateSessionToken(): string {
  return randomBytes(16).toString("hex");
}

/** Constant-time comparison to avoid leaking token bytes via timing. */
export function tokensMatch(expected: string, actual: string | undefined | null): boolean {
  if (!actual) return false;
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(actual, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
