import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ModelRepository } from "./repository.js";
import {
  ProviderInvoker,
  envSecretResolver,
  type SecretResolver,
} from "./adapters.js";
import { ModelHubService } from "./service.js";
import { HubError, fail, ok } from "./platform.js";
export interface BuildOptions {
  repository: ModelRepository;
  internalToken: string;
  secretResolver?: SecretResolver;
  fetcher?: typeof fetch;
  logger?: boolean | { level: string };
}
const kinds = [
  "chat",
  "completion",
  "embedding",
  "rerank",
  "vision",
  "image-generation",
  "image-edit",
  "speech-to-text",
  "text-to-speech",
  "video-generation",
] as const;
const providerBody = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  protocol: z.enum([
    "openai",
    "anthropic",
    "ollama",
    "stable-diffusion",
    "custom-http",
  ]),
  baseUrl: z.string().url(),
  credentialRef: z.string().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
  weight: z.number().int().positive().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
const deploymentBody = z.object({
  id: z.string().uuid().optional(),
  providerId: z.string().uuid(),
  modelId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(kinds),
  enabled: z.boolean().optional(),
  capabilities: z.array(z.string()).optional(),
  contextWindow: z.number().int().positive().optional(),
  inputPricePerMillion: z.number().nonnegative().optional(),
  outputPricePerMillion: z.number().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const policyBody = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  kind: z.enum(kinds).optional(),
  mode: z.enum(["fixed", "round-robin", "random"]),
  deploymentIds: z.array(z.string().uuid()).min(1),
  fixedDeploymentId: z.string().uuid().optional(),
  failoverOnFailure: z.boolean().optional(),
  maxAttempts: z.number().int().positive().max(10).optional(),
  enabled: z.boolean().optional(),
});
const invokeBody = z.object({
  policyId: z.string().uuid().optional(),
  deploymentId: z.string().uuid().optional(),
  kind: z.enum(kinds),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z.string(),
        name: z.string().optional(),
        toolCallId: z.string().optional(),
        toolCalls: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              input: z.record(z.string(), z.unknown()),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  prompt: z.string().optional(),
  input: z.unknown().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
  tools: z.array(z.record(z.string(), z.unknown())).optional(),
  responseFormat: z.record(z.string(), z.unknown()).optional(),
  correlationId: z.string().min(1),
});
export function buildApp(o: BuildOptions): FastifyInstance {
  const app = Fastify({
    logger: o.logger ?? false,
    genReqId: () => randomUUID(),
  });
  const fetcher = o.fetcher ?? fetch;
  const service = new ModelHubService(
    o.repository,
    new ProviderInvoker(
      o.secretResolver ?? envSecretResolver(process.env, fetcher),
      fetcher,
    ),
  );
  app.addHook("onRequest", async (req, reply) => {
    if (["/healthz", "/readyz", "/version"].includes(req.url)) return;
    if (req.headers.authorization !== `Bearer ${o.internalToken}`)
      return reply
        .code(401)
        .send(
          fail(
            "UNAUTHORIZED",
            "Missing or invalid internal service token",
            req.id,
          ),
        );
  });
  app.setErrorHandler((e, req, reply) => {
    if (e instanceof HubError)
      return reply
        .code(e.statusCode)
        .send(fail(e.code, e.message, req.id, e.retryable, e.details));
    if (e instanceof z.ZodError)
      return reply
        .code(400)
        .send(
          fail("INVALID_REQUEST", "Request validation failed", req.id, false, {
            issues: e.issues,
          }),
        );
    req.log.error(e);
    return reply
      .code(500)
      .send(fail("INTERNAL", "Unexpected Model Hub error", req.id));
  });
  app.get("/healthz", async (req) =>
    ok({ service: "model-hub", status: "ok" }, req.id),
  );
  app.get("/readyz", async (req, reply) => {
    const ready = await o.repository.ping();
    return reply
      .code(ready ? 200 : 503)
      .send(
        ready
          ? ok({ service: "model-hub", status: "ready" }, req.id)
          : fail("UNAVAILABLE", "Database is unavailable", req.id, true),
      );
  });
  app.get("/version", async (req) =>
    ok(
      { service: "model-hub", version: "0.1.0", protocolVersion: "2026-07-04" },
      req.id,
    ),
  );
  app.get("/v1/providers", async (req) =>
    ok(await o.repository.listProviders(), req.id),
  );
  app.post("/v1/providers", async (req, reply) =>
    reply
      .code(201)
      .send(
        ok(await service.saveProvider(providerBody.parse(req.body)), req.id),
      ),
  );
  app.put("/v1/providers/:id", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await service.provider(id);
    return ok(
      await service.saveProvider({ ...providerBody.omit({ id: true }).parse(req.body), id }),
      req.id,
    );
  });
  app.get("/v1/providers/:id", async (req) =>
    ok(
      await service.provider(
        z.object({ id: z.string().uuid() }).parse(req.params).id,
      ),
      req.id,
    ),
  );
  app.delete("/v1/providers/:id", async (req) =>
    ok(
      await service.removeProvider(
        z.object({ id: z.string().uuid() }).parse(req.params).id,
      ),
      req.id,
    ),
  );
  app.post("/v1/providers/:id/probe", async (req) =>
    ok(
      await service.probe(
        z.object({ id: z.string().uuid() }).parse(req.params).id,
      ),
      req.id,
    ),
  );
  app.get("/v1/models", async (req) => {
    const q = z
      .object({
        providerId: z.string().uuid().optional(),
        kind: z.enum(kinds).optional(),
      })
      .parse(req.query);
    const all = await o.repository.listDeployments(q.providerId);
    return ok(q.kind ? all.filter((x) => x.kind === q.kind) : all, req.id);
  });
  app.post("/v1/models", async (req, reply) =>
    reply
      .code(201)
      .send(
        ok(
          await service.saveDeployment(deploymentBody.parse(req.body)),
          req.id,
        ),
      ),
  );
  app.get("/v1/models/:id", async (req) =>
    ok(
      await service.deployment(
        z.object({ id: z.string().uuid() }).parse(req.params).id,
      ),
      req.id,
    ),
  );
  app.put("/v1/models/:id", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await service.deployment(id);
    return ok(
      await service.saveDeployment({
        ...deploymentBody.omit({ id: true }).parse(req.body),
        id,
      }),
      req.id,
    );
  });
  app.delete("/v1/models/:id", async (req) =>
    ok(
      await service.removeDeployment(
        z.object({ id: z.string().uuid() }).parse(req.params).id,
      ),
      req.id,
    ),
  );
  app.get("/v1/routing-policies", async (req) =>
    ok(await o.repository.listPolicies(), req.id),
  );
  app.post("/v1/routing-policies", async (req, reply) =>
    reply
      .code(201)
      .send(ok(await service.savePolicy(policyBody.parse(req.body)), req.id)),
  );
  app.get("/v1/routing-policies/:id", async (req) =>
    ok(
      await service.policy(
        z.object({ id: z.string().uuid() }).parse(req.params).id,
      ),
      req.id,
    ),
  );
  app.put("/v1/routing-policies/:id", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await service.policy(id);
    return ok(
      await service.savePolicy({
        ...policyBody.omit({ id: true }).parse(req.body),
        id,
      }),
      req.id,
    );
  });
  app.delete("/v1/routing-policies/:id", async (req) =>
    ok(
      await service.removePolicy(
        z.object({ id: z.string().uuid() }).parse(req.params).id,
      ),
      req.id,
    ),
  );
  app.post("/v1/select", async (req) =>
    ok(
      await service.select(
        z
          .object({
            policyId: z.string().uuid().optional(),
            deploymentId: z.string().uuid().optional(),
            kind: z.enum(kinds).optional(),
          })
          .parse(req.body),
      ),
      req.id,
    ),
  );
  app.post("/v1/invoke", async (req) =>
    ok(await service.invoke(invokeBody.parse(req.body)), req.id),
  );
  app.get("/v1/usage/summary", async (req) =>
    ok(
      await o.repository.usageSummary(
        z
          .object({
            from: z.string().datetime().optional(),
            to: z.string().datetime().optional(),
            providerId: z.string().uuid().optional(),
          })
          .parse(req.query),
      ),
      req.id,
    ),
  );
  app.get("/v1/capability-exports", async (req) => {
    const models = (await o.repository.listDeployments()).filter(
      (x) => x.enabled,
    );
    return ok(
      models.map((x) => ({
        id: `model:${x.id}`,
        name: x.name,
        kind: x.kind,
        description: `Invoke ${x.name} (${x.modelId})`,
        inputSchema: { type: "object" },
        deploymentId: x.id,
        capabilities: x.capabilities,
      })),
      req.id,
    );
  });
  app.addHook("onClose", async () => o.repository.close());
  return app;
}
