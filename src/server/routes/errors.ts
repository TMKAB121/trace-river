import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppState } from "../app-state.js";
import { assemblePrompt } from "../../errors/prompt.js";

/**
 * `GET /api/errors` -> convenience mirror of the WS-pushed `errorGroups`
 * value (docs/specs/004-phase-4-error-intelligence.md § API contract),
 * matching the existing `GET /api/docker/status` / `GET /api/discovery`
 * precedent.
 *
 * `GET /api/errors/:fingerprint/prompt` -> server-assembles and redacts the
 * AI debugging prompt for one tracked ErrorGroup. `404 { error: "not_found" }`
 * when the fingerprint has never existed or has since been evicted from the
 * 500-cap LRU.
 */
export function registerErrorsRoute(fastify: FastifyInstance, state: AppState): void {
  fastify.get("/api/errors", async () => {
    return { groups: state.errorGroups.list() };
  });

  fastify.get(
    "/api/errors/:fingerprint/prompt",
    async (request: FastifyRequest<{ Params: { fingerprint: string } }>, reply) => {
      const prompt = assemblePrompt(state, request.params.fingerprint);
      if (prompt === null) {
        return reply.code(404).send({ error: "not_found" });
      }
      return { prompt };
    },
  );
}
