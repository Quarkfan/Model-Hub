import { Pool, type QueryResultRow } from "pg";
import type { ModelRepository } from "./repository.js";
import type {
  ModelDeployment,
  ModelProvider,
  RoutingPolicy,
  UsageRecord,
} from "./types.js";
const sql = `CREATE SCHEMA IF NOT EXISTS mh;
CREATE TABLE IF NOT EXISTS mh.providers(id text PRIMARY KEY,name text NOT NULL,protocol text NOT NULL,base_url text NOT NULL,credential_ref text,enabled boolean NOT NULL,priority integer NOT NULL,weight integer NOT NULL,headers jsonb NOT NULL DEFAULT '{}',status text NOT NULL,last_probe_at timestamptz,last_error text,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS mh.deployments(id text PRIMARY KEY,provider_id text NOT NULL REFERENCES mh.providers(id) ON DELETE CASCADE,model_id text NOT NULL,name text NOT NULL,kind text NOT NULL,enabled boolean NOT NULL,capabilities jsonb NOT NULL DEFAULT '[]',context_window integer,input_price numeric,output_price numeric,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,UNIQUE(provider_id,model_id,kind));
CREATE TABLE IF NOT EXISTS mh.routing_policies(id text PRIMARY KEY,name text NOT NULL,kind text,mode text NOT NULL,deployment_ids jsonb NOT NULL,fixed_deployment_id text,failover_on_failure boolean NOT NULL,max_attempts integer NOT NULL,enabled boolean NOT NULL,cursor integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS mh.usage(id text PRIMARY KEY,invocation_id text NOT NULL,provider_id text NOT NULL,deployment_id text NOT NULL,model_id text NOT NULL,kind text NOT NULL,input_tokens integer NOT NULL,output_tokens integer NOT NULL,estimated_cost numeric NOT NULL,status text NOT NULL,latency_ms integer NOT NULL,correlation_id text NOT NULL,created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS usage_time_idx ON mh.usage(created_at DESC,provider_id,model_id);`;
const provider = (r: QueryResultRow): ModelProvider => ({
  id: r.id,
  name: r.name,
  protocol: r.protocol,
  baseUrl: r.base_url,
  credentialRef: r.credential_ref ?? undefined,
  enabled: r.enabled,
  priority: r.priority,
  weight: r.weight,
  headers: r.headers ?? {},
  status: r.status,
  lastProbeAt: r.last_probe_at?.toISOString(),
  lastError: r.last_error ?? undefined,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
const deployment = (r: QueryResultRow): ModelDeployment => ({
  id: r.id,
  providerId: r.provider_id,
  modelId: r.model_id,
  name: r.name,
  kind: r.kind,
  enabled: r.enabled,
  capabilities: r.capabilities ?? [],
  contextWindow: r.context_window ?? undefined,
  inputPricePerMillion:
    r.input_price === null ? undefined : Number(r.input_price),
  outputPricePerMillion:
    r.output_price === null ? undefined : Number(r.output_price),
  metadata: r.metadata ?? {},
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
const policy = (r: QueryResultRow): RoutingPolicy => ({
  id: r.id,
  name: r.name,
  kind: r.kind ?? undefined,
  mode: r.mode,
  deploymentIds: r.deployment_ids ?? [],
  fixedDeploymentId: r.fixed_deployment_id ?? undefined,
  failoverOnFailure: r.failover_on_failure,
  maxAttempts: r.max_attempts,
  enabled: r.enabled,
  cursor: r.cursor,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
const json = (value: unknown) => JSON.stringify(value);
export class PgModelRepository implements ModelRepository {
  pool: Pool;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 10 });
  }
  async migrate() {
    await this.pool.query(sql);
  }
  async close() {
    await this.pool.end();
  }
  async ping() {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
  async listProviders() {
    return (
      await this.pool.query("SELECT * FROM mh.providers ORDER BY priority,name")
    ).rows.map(provider);
  }
  async getProvider(id: string) {
    const r = (
      await this.pool.query("SELECT * FROM mh.providers WHERE id=$1", [id])
    ).rows[0];
    return r ? provider(r) : undefined;
  }
  async saveProvider(v: ModelProvider) {
    const r = (
      await this.pool.query(
        `INSERT INTO mh.providers(id,name,protocol,base_url,credential_ref,enabled,priority,weight,headers,status,last_probe_at,last_error,created_at,updated_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)ON CONFLICT(id)DO UPDATE SET name=EXCLUDED.name,protocol=EXCLUDED.protocol,base_url=EXCLUDED.base_url,credential_ref=EXCLUDED.credential_ref,enabled=EXCLUDED.enabled,priority=EXCLUDED.priority,weight=EXCLUDED.weight,headers=EXCLUDED.headers,status=EXCLUDED.status,last_probe_at=EXCLUDED.last_probe_at,last_error=EXCLUDED.last_error,updated_at=EXCLUDED.updated_at RETURNING *`,
        [
          v.id,
          v.name,
          v.protocol,
          v.baseUrl,
          v.credentialRef ?? null,
          v.enabled,
          v.priority,
          v.weight,
          v.headers,
          v.status,
          v.lastProbeAt ?? null,
          v.lastError ?? null,
          v.createdAt,
          v.updatedAt,
        ],
      )
    ).rows[0];
    return provider(r);
  }
  async removeProvider(id: string) {
    return (
      (await this.pool.query("DELETE FROM mh.providers WHERE id=$1", [id]))
        .rowCount === 1
    );
  }
  async listDeployments(providerId?: string) {
    return (
      await this.pool.query(
        `SELECT * FROM mh.deployments ${providerId ? "WHERE provider_id=$1" : ""} ORDER BY name`,
        providerId ? [providerId] : [],
      )
    ).rows.map(deployment);
  }
  async getDeployment(id: string) {
    const r = (
      await this.pool.query("SELECT * FROM mh.deployments WHERE id=$1", [id])
    ).rows[0];
    return r ? deployment(r) : undefined;
  }
  async saveDeployment(v: ModelDeployment) {
    const r = (
      await this.pool.query(
        `INSERT INTO mh.deployments(id,provider_id,model_id,name,kind,enabled,capabilities,context_window,input_price,output_price,metadata,created_at,updated_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)ON CONFLICT(id)DO UPDATE SET provider_id=EXCLUDED.provider_id,model_id=EXCLUDED.model_id,name=EXCLUDED.name,kind=EXCLUDED.kind,enabled=EXCLUDED.enabled,capabilities=EXCLUDED.capabilities,context_window=EXCLUDED.context_window,input_price=EXCLUDED.input_price,output_price=EXCLUDED.output_price,metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at RETURNING *`,
        [
          v.id,
          v.providerId,
          v.modelId,
          v.name,
          v.kind,
          v.enabled,
          json(v.capabilities),
          v.contextWindow ?? null,
          v.inputPricePerMillion ?? null,
          v.outputPricePerMillion ?? null,
          v.metadata,
          v.createdAt,
          v.updatedAt,
        ],
      )
    ).rows[0];
    return deployment(r);
  }
  async removeDeployment(id: string) {
    return (
      (await this.pool.query("DELETE FROM mh.deployments WHERE id=$1", [id]))
        .rowCount === 1
    );
  }
  async listPolicies() {
    return (
      await this.pool.query("SELECT * FROM mh.routing_policies ORDER BY name")
    ).rows.map(policy);
  }
  async getPolicy(id: string) {
    const r = (
      await this.pool.query("SELECT * FROM mh.routing_policies WHERE id=$1", [
        id,
      ])
    ).rows[0];
    return r ? policy(r) : undefined;
  }
  async savePolicy(v: RoutingPolicy) {
    const r = (
      await this.pool.query(
        `INSERT INTO mh.routing_policies(id,name,kind,mode,deployment_ids,fixed_deployment_id,failover_on_failure,max_attempts,enabled,cursor,created_at,updated_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)ON CONFLICT(id)DO UPDATE SET name=EXCLUDED.name,kind=EXCLUDED.kind,mode=EXCLUDED.mode,deployment_ids=EXCLUDED.deployment_ids,fixed_deployment_id=EXCLUDED.fixed_deployment_id,failover_on_failure=EXCLUDED.failover_on_failure,max_attempts=EXCLUDED.max_attempts,enabled=EXCLUDED.enabled,updated_at=EXCLUDED.updated_at RETURNING *`,
        [
          v.id,
          v.name,
          v.kind ?? null,
          v.mode,
          json(v.deploymentIds),
          v.fixedDeploymentId ?? null,
          v.failoverOnFailure,
          v.maxAttempts,
          v.enabled,
          v.cursor,
          v.createdAt,
          v.updatedAt,
        ],
      )
    ).rows[0];
    return policy(r);
  }
  async advancePolicyCursor(id: string, modulo: number) {
    const r = (
      await this.pool.query(
        "UPDATE mh.routing_policies SET cursor=(cursor+1)%$2,updated_at=now() WHERE id=$1 RETURNING (cursor-1+$2)%$2 AS selected",
        [id, modulo],
      )
    ).rows[0];
    return Number(r?.selected ?? 0);
  }
  async appendUsage(v: UsageRecord) {
    await this.pool.query(
      "INSERT INTO mh.usage(id,invocation_id,provider_id,deployment_id,model_id,kind,input_tokens,output_tokens,estimated_cost,status,latency_ms,correlation_id,created_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        v.id,
        v.invocationId,
        v.providerId,
        v.deploymentId,
        v.modelId,
        v.kind,
        v.inputTokens,
        v.outputTokens,
        v.estimatedCost,
        v.status,
        v.latencyMs,
        v.correlationId,
        v.createdAt,
      ],
    );
  }
  async usageSummary(f: { from?: string; to?: string; providerId?: string }) {
    const vals: unknown[] = [];
    const w: string[] = [];
    for (const [col, val] of [
      ["created_at >=", f.from],
      ["created_at <=", f.to],
      ["provider_id =", f.providerId],
    ] as const)
      if (val) {
        vals.push(val);
        w.push(`${col} $${vals.length}`);
      }
    return (
      await this.pool.query(
        `SELECT provider_id,model_id,count(*)::int requests,count(*) FILTER(WHERE status='failed')::int failures,coalesce(sum(input_tokens),0)::int input_tokens,coalesce(sum(output_tokens),0)::int output_tokens,coalesce(sum(estimated_cost),0)::float8 estimated_cost FROM mh.usage ${w.length ? `WHERE ${w.join(" AND ")}` : ""} GROUP BY provider_id,model_id ORDER BY requests DESC`,
        vals,
      )
    ).rows.map((r) => ({
      providerId: r.provider_id,
      modelId: r.model_id,
      requests: r.requests,
      failures: r.failures,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      estimatedCost: r.estimated_cost,
    }));
  }
}
