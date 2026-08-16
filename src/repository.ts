import type {
  ModelDeployment,
  ModelProvider,
  RoutingPolicy,
  UsageRecord,
} from "./types.js";
export interface ModelRepository {
  migrate(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<boolean>;
  listProviders(): Promise<ModelProvider[]>;
  getProvider(id: string): Promise<ModelProvider | undefined>;
  saveProvider(v: ModelProvider): Promise<ModelProvider>;
  removeProvider(id: string): Promise<boolean>;
  listDeployments(providerId?: string): Promise<ModelDeployment[]>;
  getDeployment(id: string): Promise<ModelDeployment | undefined>;
  saveDeployment(v: ModelDeployment): Promise<ModelDeployment>;
  removeDeployment(id: string): Promise<boolean>;
  listPolicies(): Promise<RoutingPolicy[]>;
  getPolicy(id: string): Promise<RoutingPolicy | undefined>;
  savePolicy(v: RoutingPolicy): Promise<RoutingPolicy>;
  removePolicy(id: string): Promise<boolean>;
  advancePolicyCursor(id: string, modulo: number): Promise<number>;
  appendUsage(v: UsageRecord): Promise<void>;
  usageSummary(filter: {
    from?: string;
    to?: string;
    providerId?: string;
  }): Promise<
    Array<{
      providerId: string;
      modelId: string;
      requests: number;
      failures: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCost: number;
    }>
  >;
}
export class MemoryModelRepository implements ModelRepository {
  providers = new Map<string, ModelProvider>();
  deployments = new Map<string, ModelDeployment>();
  policies = new Map<string, RoutingPolicy>();
  usage: UsageRecord[] = [];
  async migrate() {}
  async close() {}
  async ping() {
    return true;
  }
  async listProviders() {
    return [...this.providers.values()];
  }
  async getProvider(id: string) {
    return this.providers.get(id);
  }
  async saveProvider(v: ModelProvider) {
    this.providers.set(v.id, structuredClone(v));
    return v;
  }
  async removeProvider(id: string) {
    return this.providers.delete(id);
  }
  async listDeployments(providerId?: string) {
    return [...this.deployments.values()].filter(
      (v) => !providerId || v.providerId === providerId,
    );
  }
  async getDeployment(id: string) {
    return this.deployments.get(id);
  }
  async saveDeployment(v: ModelDeployment) {
    this.deployments.set(v.id, structuredClone(v));
    return v;
  }
  async removeDeployment(id: string) {
    return this.deployments.delete(id);
  }
  async listPolicies() {
    return [...this.policies.values()];
  }
  async getPolicy(id: string) {
    return this.policies.get(id);
  }
  async savePolicy(v: RoutingPolicy) {
    this.policies.set(v.id, structuredClone(v));
    return v;
  }
  async removePolicy(id: string) {
    return this.policies.delete(id);
  }
  async advancePolicyCursor(id: string, modulo: number) {
    const p = this.policies.get(id);
    if (!p) return 0;
    const selected = p.cursor % modulo;
    p.cursor = (p.cursor + 1) % modulo;
    p.updatedAt = new Date().toISOString();
    this.policies.set(id, p);
    return selected;
  }
  async appendUsage(v: UsageRecord) {
    this.usage.push(structuredClone(v));
  }
  async usageSummary(f: { from?: string; to?: string; providerId?: string }) {
    const map = new Map<
      string,
      {
        providerId: string;
        modelId: string;
        requests: number;
        failures: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCost: number;
      }
    >();
    for (const u of this.usage) {
      if (
        (f.providerId && u.providerId !== f.providerId) ||
        (f.from && u.createdAt < f.from) ||
        (f.to && u.createdAt > f.to)
      )
        continue;
      const k = `${u.providerId}:${u.modelId}`;
      const x = map.get(k) ?? {
        providerId: u.providerId,
        modelId: u.modelId,
        requests: 0,
        failures: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
      };
      x.requests++;
      if (u.status === "failed") x.failures++;
      x.inputTokens += u.inputTokens;
      x.outputTokens += u.outputTokens;
      x.estimatedCost += u.estimatedCost;
      map.set(k, x);
    }
    return [...map.values()];
  }
}
