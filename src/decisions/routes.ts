import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { EvidenceRepository } from "../evidence/index.js";
import { renderDecisionDetailPage, renderDecisionListPage } from "./html.js";
import { decisionDetail, decisionSummary } from "./model.js";

const DecisionListQuerySchema = z
  .object({
    verdict: z.enum(["ALLOW", "BLOCK", "REQUIRE_APPROVAL"]).optional(),
    provider: z.literal("highnote").optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

const DecisionIdParamsSchema = z.object({ decisionId: z.string().min(1).max(128) }).strict();
const HighnoteRequestParamsSchema = z.object({ requestId: z.string().min(1).max(128) }).strict();

function readHeaders(reply: FastifyReply, html = false): void {
  reply.header("cache-control", "no-store");
  reply.header("x-content-type-options", "nosniff");
  reply.header("referrer-policy", "no-referrer");
  if (html) {
    reply.header(
      "content-security-policy",
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    );
    reply.type("text/html; charset=utf-8");
  }
}

function invalidQuery(reply: FastifyReply) {
  reply.code(400);
  return { error: { code: "INVALID_QUERY", message: "Decision query is invalid" } };
}

function notFound(reply: FastifyReply) {
  reply.code(404);
  return { error: { code: "DECISION_NOT_FOUND", message: "Inntris decision was not found" } };
}

export function registerInntrisDecisionRoutes(
  app: FastifyInstance,
  repository: EvidenceRepository,
): void {
  app.get("/v1/inntris/decisions", async (request, reply) => {
    readHeaders(reply);
    const query = DecisionListQuerySchema.safeParse(request.query);
    if (!query.success) return invalidQuery(reply);
    const bundles = await repository.listRecent({
      limit: query.data.limit,
      ...(query.data.verdict === undefined ? {} : { verdict: query.data.verdict }),
      ...(query.data.provider === undefined ? {} : { provider: query.data.provider }),
    });
    const decisions = bundles.map(decisionSummary);
    return { decisions, count: decisions.length };
  });

  app.get("/v1/inntris/decisions/by-highnote-request/:requestId", async (request, reply) => {
    readHeaders(reply);
    const parameters = HighnoteRequestParamsSchema.safeParse(request.params);
    if (!parameters.success) return invalidQuery(reply);
    const bundle = await repository.findByHighnoteRequestId(parameters.data.requestId);
    return bundle === undefined ? notFound(reply) : decisionDetail(bundle);
  });

  app.get("/v1/inntris/decisions/:decisionId", async (request, reply) => {
    readHeaders(reply);
    const parameters = DecisionIdParamsSchema.safeParse(request.params);
    if (!parameters.success) return invalidQuery(reply);
    const bundle = await repository.findByDecisionId(parameters.data.decisionId);
    return bundle === undefined ? notFound(reply) : decisionDetail(bundle);
  });

  app.get("/inntris/decisions", async (_request, reply) => {
    readHeaders(reply, true);
    const bundles = await repository.listRecent({ provider: "highnote", limit: 100 });
    return renderDecisionListPage(bundles.map(decisionSummary));
  });

  app.get("/inntris/decisions/:decisionId", async (request, reply) => {
    readHeaders(reply, true);
    const parameters = DecisionIdParamsSchema.safeParse(request.params);
    if (!parameters.success) {
      reply.code(400);
      return renderDecisionListPage([]);
    }
    const bundle = await repository.findByDecisionId(parameters.data.decisionId);
    if (bundle === undefined) {
      reply.code(404);
      return renderDecisionListPage([]);
    }
    return renderDecisionDetailPage(decisionDetail(bundle));
  });
}
