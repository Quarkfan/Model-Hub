import { randomInt, randomUUID } from "node:crypto";
import type { ModelRepository } from "./repository.js";
import type {
  AttemptPlan,
  ModelDeployment,
  ModelInvokeRequest,
  ModelInvokeResult,
  ModelProvider,
  RoutingPolicy,
  UsageRecord,
} from "./types.js";
import { HubError } from "./platform.js";
import { ProviderInvoker } from "./adapters.js";
export class ModelHubService {
  constructor(
    readonly repo: ModelRepository,
    private invoker: ProviderInvoker,
  ) {}
  async saveProvider(
    i: Partial<ModelProvider> &
      Pick<ModelProvider, "name" | "protocol" | "baseUrl">,
  ) {
    const old = i.id ? await this.repo.getProvider(i.id) : undefined,
      n = new Date().toISOString();
    return this.repo.saveProvider({
      id: i.id ?? randomUUID(),
      name: i.name,
      protocol: i.protocol,
      baseUrl: i.baseUrl,
      credentialRef: i.credentialRef,
      enabled: i.enabled ?? true,
      priority: i.priority ?? 100,
      weight: i.weight ?? 1,
      headers: i.headers ?? {},
      status: i.enabled === false ? "disabled" : "configured",
      lastProbeAt: old?.lastProbeAt,
      lastError: old?.lastError,
      createdAt: old?.createdAt ?? n,
      updatedAt: n,
    });
  }
  async provider(id: string) {
    const v = await this.repo.getProvider(id);
    if (!v) throw new HubError("NOT_FOUND", `Provider not found: ${id}`, 404);
    return v;
  }
  async probe(id: string) {
    const p = await this.provider(id);
    try {
      await this.invoker.probe(p);
      p.status = "healthy";
      p.lastError = undefined;
    } catch (e) {
      p.status = "error";
      p.lastError = e instanceof Error ? e.message : String(e);
    }
    p.lastProbeAt = new Date().toISOString();
    p.updatedAt = p.lastProbeAt;
    await this.repo.saveProvider(p);
    return {
      providerId: p.id,
      status: p.status,
      lastProbeAt: p.lastProbeAt,
      lastError: p.lastError,
    };
  }
  async saveDeployment(
    i: Partial<ModelDeployment> &
      Pick<ModelDeployment, "providerId" | "modelId" | "name" | "kind">,
  ) {
    await this.provider(i.providerId);
    const old = i.id ? await this.repo.getDeployment(i.id) : undefined,
      n = new Date().toISOString();
    return this.repo.saveDeployment({
      id: i.id ?? randomUUID(),
      providerId: i.providerId,
      modelId: i.modelId,
      name: i.name,
      kind: i.kind,
      enabled: i.enabled ?? true,
      capabilities: i.capabilities ?? [],
      contextWindow: i.contextWindow,
      inputPricePerMillion: i.inputPricePerMillion,
      outputPricePerMillion: i.outputPricePerMillion,
      metadata: i.metadata ?? {},
      createdAt: old?.createdAt ?? n,
      updatedAt: n,
    });
  }
  async deployment(id: string) {
    const v = await this.repo.getDeployment(id);
    if (!v) throw new HubError("NOT_FOUND", `Deployment not found: ${id}`, 404);
    return v;
  }
  async savePolicy(
    i: Partial<RoutingPolicy> &
      Pick<RoutingPolicy, "name" | "mode" | "deploymentIds">,
  ) {
    if (!i.deploymentIds.length)
      throw new HubError(
        "INVALID_REQUEST",
        "Routing policy requires deployments",
        400,
      );
    for (const id of i.deploymentIds) await this.deployment(id);
    const old = i.id ? await this.repo.getPolicy(i.id) : undefined,
      n = new Date().toISOString();
    return this.repo.savePolicy({
      id: i.id ?? randomUUID(),
      name: i.name,
      kind: i.kind,
      mode: i.mode,
      deploymentIds: [...new Set(i.deploymentIds)],
      fixedDeploymentId: i.fixedDeploymentId,
      failoverOnFailure: i.failoverOnFailure ?? true,
      maxAttempts: Math.min(
        Math.max(i.maxAttempts ?? i.deploymentIds.length, 1),
        10,
      ),
      enabled: i.enabled ?? true,
      cursor: old?.cursor ?? 0,
      createdAt: old?.createdAt ?? n,
      updatedAt: n,
    });
  }
  async policy(id: string) {
    const v = await this.repo.getPolicy(id);
    if (!v)
      throw new HubError("NOT_FOUND", `Routing policy not found: ${id}`, 404);
    return v;
  }
  async select(input: {
    policyId?: string;
    deploymentId?: string;
    kind?: ModelDeployment["kind"];
  }): Promise<AttemptPlan> {
    if (input.deploymentId) {
      const d = await this.deployment(input.deploymentId);
      const p = await this.provider(d.providerId);
      if (!d.enabled || !p.enabled)
        throw new HubError("UNAVAILABLE", "Deployment is disabled", 409);
      return {
        policyId: "explicit",
        attempts: [
          {
            index: 0,
            deploymentId: d.id,
            providerId: p.id,
            modelId: d.modelId,
            kind: d.kind,
          },
        ],
      };
    }
    if (!input.policyId)
      throw new HubError(
        "INVALID_REQUEST",
        "policyId or deploymentId is required",
        400,
      );
    const policy = await this.policy(input.policyId);
    if (!policy.enabled)
      throw new HubError("UNAVAILABLE", "Routing policy is disabled", 409);
    const candidates = [];
    for (const id of policy.deploymentIds) {
      const d = await this.repo.getDeployment(id);
      if (
        !d ||
        !d.enabled ||
        (input.kind && d.kind !== input.kind) ||
        (policy.kind && d.kind !== policy.kind)
      )
        continue;
      const p = await this.repo.getProvider(d.providerId);
      if (p?.enabled) candidates.push({ d, p });
    }
    if (!candidates.length)
      throw new HubError(
        "UNAVAILABLE",
        "Routing policy has no healthy enabled candidates",
        503,
        true,
      );
    let start = 0;
    if (policy.mode === "fixed") {
      const fixed = policy.fixedDeploymentId ?? policy.deploymentIds[0];
      start = Math.max(
        candidates.findIndex((x) => x.d.id === fixed),
        0,
      );
    } else if (policy.mode === "random") start = randomInt(candidates.length);
    else
      start = await this.repo.advancePolicyCursor(policy.id, candidates.length);
    const ordered = [...candidates.slice(start), ...candidates.slice(0, start)];
    const count = policy.failoverOnFailure
      ? Math.min(policy.maxAttempts, ordered.length)
      : 1;
    return {
      policyId: policy.id,
      attempts: ordered
        .slice(0, count)
        .map((x, index) => ({
          index,
          deploymentId: x.d.id,
          providerId: x.p.id,
          modelId: x.d.modelId,
          kind: x.d.kind,
        })),
    };
  }
  async invoke(i: ModelInvokeRequest): Promise<ModelInvokeResult> {
    const plan = await this.select({
      policyId: i.policyId,
      deploymentId: i.deploymentId,
      kind: i.kind,
    });
    const invocationId = randomUUID();
    const attempts: ModelInvokeResult["attempts"] = [];
    for (const a of plan.attempts) {
      const d = await this.deployment(a.deploymentId),
        p = await this.provider(a.providerId),
        started = Date.now();
      try {
        const result = await this.invoker.invoke(p, d, i),
          latencyMs = Date.now() - started,
          cost =
            (result.inputTokens * (d.inputPricePerMillion ?? 0) +
              result.outputTokens * (d.outputPricePerMillion ?? 0)) /
            1_000_000;
        attempts.push({
          deploymentId: d.id,
          status: "success",
          durationMs: latencyMs,
        });
        await this.usage({
          invocationId,
          p,
          d,
          i,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          cost,
          status: "success",
          latencyMs,
        });
        return {
          invocationId,
          deploymentId: d.id,
          providerId: p.id,
          modelId: d.modelId,
          kind: d.kind,
          output: result.output,
          finishReason: result.finishReason,
          usage: {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            totalTokens: result.inputTokens + result.outputTokens,
            estimatedCost: cost,
          },
          attempts,
        };
      } catch (e) {
        const latencyMs = Date.now() - started;
        attempts.push({
          deploymentId: d.id,
          status: "failed",
          durationMs: latencyMs,
          errorCode: e instanceof HubError ? e.code : "INTERNAL",
        });
        await this.usage({
          invocationId,
          p,
          d,
          i,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          status: "failed",
          latencyMs,
        });
      }
    }
    throw new HubError(
      "UPSTREAM_FAILED",
      "All model attempts failed",
      502,
      true,
      { invocationId, attempts },
    );
  }
  private async usage(x: {
    invocationId: string;
    p: ModelProvider;
    d: ModelDeployment;
    i: ModelInvokeRequest;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    status: UsageRecord["status"];
    latencyMs: number;
  }) {
    await this.repo.appendUsage({
      id: randomUUID(),
      invocationId: x.invocationId,
      providerId: x.p.id,
      deploymentId: x.d.id,
      modelId: x.d.modelId,
      kind: x.d.kind,
      inputTokens: x.inputTokens,
      outputTokens: x.outputTokens,
      estimatedCost: x.cost,
      status: x.status,
      latencyMs: x.latencyMs,
      correlationId: x.i.correlationId,
      createdAt: new Date().toISOString(),
    });
  }
}
