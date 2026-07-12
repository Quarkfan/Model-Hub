# Model Hub 可执行设计蓝图

本文把 [`model-hub.md`](model-hub.md) 中的领域设计收口成可直接建设的工程蓝图。它面向后续实现、测试、迁移和验收，不重新解释 MH 为什么存在。

## 1. 建设目标

P0 目标是先在 macOS 单机版内形成可替换的 Model Hub 子系统，承接当前 QuarkfanTools 中分散的 MODEL PROVIDER 配置、轮流/随机策略、失败切换、模型能力判断和 runtime model 参数。

P0 必须做到：

- 模型 provider、credential、deployment、capability、routing policy、fallback policy、health、usage 和 trace 有统一 DTO。
- 模型能力按 task/modality 描述，不默认所有模型都是 chat LLM。
- 支持固定、轮流、随机三种策略，支持失败切换和 cooldown。
- 运行时中心、CH、工具中心只能拿到 model attempt plan 或 capability export，不能拿到原始 secret。
- 用量记录覆盖 token、耗时、成功/失败、fallback attempt、estimated cost 和错误类别。
- 工具中心可以把模型能力封装为工具，但工具注册、授权和工作流不进入 MH。
- 管理面能看到 provider status、model list、credential status、routing policy、fallback attempts、health logs 和 usage summary。

P0 不做：

- 不建设独立服务端，不改变当前 macOS 本机交付形态。
- 不打包 Stable Diffusion、vLLM、ComfyUI 或 Ollama runtime。
- 不做完整多租户计费、充值、成本中心。
- 不执行 Agent session，不构造最终 prompt。
- 不自动把所有模型能力暴露为工具。
- 不记录未脱敏 prompt、图片、音频、生成内容或客户数据正文。

## 2. 模块边界

MH 内部拆成八个工程模块。P0 可以先在单机版里实现为一个 `ModelHub` facade 和若干本地模块，后续再迁移为独立包或进程。

| 模块 | P0 职责 | 主要持久化 | 对外接口 |
| --- | --- | --- | --- |
| Provider Registry | 管理 provider 类型、adapter、baseUrlRef、credentialRefs | `providers/*.json` | `providers list/status/probe` |
| Credential Registry | 管理 secretRef、credential status、scope、轮换状态 | secret store refs、`credentials/*.json` | `credentials list/status` |
| Deployment Registry | 管理模型 deployment、task、modality、capability、cost profile | `deployments/*.json` | `models list/refresh` |
| Routing Engine | 固定/轮流/随机选择，生成 attempt plan | `routing-policies/*.json`、state | `selectModel` |
| Fallback Manager | retry、fallback、cooldown、allowed fail、error class | `fallback-policies/*.json`、cooldown state | attempt planning |
| Health Monitor | probe、model list refresh、provider availability、latency | `health-events.jsonl` | `probeDeployment` |
| Usage & Cost Ledger | usage、latency、tokens、estimated cost、success/failure | `usage-records.jsonl` | `recordUsage/queryUsage` |
| Capability Exporter | 输出可被工具中心封装的模型能力 | `capability-exports/*.json` | `exports list/get` |

工程边界规则：

- Provider Registry 不保存原始 API Key，只保存 credentialRef。
- Routing Engine 只生成计划，不执行 runtime。
- Fallback Manager 不能选择未授权 deployment。
- Usage Ledger 不保存未脱敏 prompt 或 output。
- Capability Exporter 不创建工具，只声明模型能力和 schema。
- Health Monitor 不用用户数据做探针。

## 3. P0 数据模型清单

### 3.1 Scope / Actor

```ts
interface ModelActor {
  actorType: "runtime" | "context-hub" | "tool" | "scheduler" | "user" | "system";
  actorId: string;
  ownerId?: string;
}

interface ModelScope {
  botId?: string;
  ownerId?: string;
  workspaceId?: string;
  projectId?: string;
  organizationId?: string;
  capabilityRef?: string;
}
```

### 3.2 Provider / Credential

```ts
type ModelProviderKind =
  | "hosted"
  | "openai-compatible"
  | "local-runtime"
  | "self-hosted"
  | "aggregator"
  | "desktop-app";

interface ModelProvider {
  providerId: string;
  kind: ModelProviderKind;
  displayName: string;
  adapter: string;
  baseUrlRef?: string;
  credentialRefs: string[];
  supportedModalities: ModelModality[];
  status: "active" | "disabled" | "needs-auth" | "failed";
  createdAt: string;
  updatedAt: string;
}

interface ModelCredentialRef {
  credentialRef: string;
  providerId: string;
  scope: ModelScope;
  status: "active" | "missing" | "expired" | "revoked" | "invalid";
  displayName?: string;
  lastValidatedAt?: string;
}
```

### 3.3 Deployment / Capability

```ts
type ModelModality = "text" | "image" | "audio" | "video" | "embedding" | "rerank" | "multimodal";

type ModelTask =
  | "chat"
  | "agent"
  | "completion"
  | "embedding"
  | "rerank"
  | "moderation"
  | "vision"
  | "ocr"
  | "speech-to-text"
  | "text-to-speech"
  | "image-generation"
  | "image-editing"
  | "image-upscale"
  | "classification";

interface ModelCapability {
  streaming?: boolean;
  tools?: boolean;
  jsonMode?: boolean;
  structuredOutput?: boolean;
  vision?: boolean;
  audioInput?: boolean;
  audioOutput?: boolean;
  imageInput?: boolean;
  imageOutput?: boolean;
  batch?: boolean;
  localOnly?: boolean;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportedParameters?: Record<string, ModelParameterSchema>;
}

interface ModelDeployment {
  deploymentId: string;
  providerId: string;
  model: string;
  displayName?: string;
  tasks: ModelTask[];
  modalities: ModelModality[];
  capabilities: ModelCapability;
  credentialRef: string;
  endpointRef?: string;
  costProfileRef?: string;
  status: "active" | "disabled" | "cooldown" | "failed" | "quota-exceeded" | "no-permission";
  lastHealth?: ModelHealthCheck;
  createdAt: string;
  updatedAt: string;
}
```

### 3.4 Routing / Fallback

```ts
interface ModelRoutingPolicy {
  policyId: string;
  name: string;
  scope: ModelScope;
  task: ModelTask;
  strategy: "fixed" | "round-robin" | "random" | "least-busy" | "lowest-cost" | "lowest-latency";
  deploymentIds: string[];
  fallbackPolicyId?: string;
  enabled: boolean;
}

interface ModelRetryPolicy {
  maxRetries: number;
  retryOn: Array<"timeout" | "rate-limit" | "server-error" | "connection" | "quota" | "content-policy">;
  backoffMs?: number;
}

interface ModelFallbackPolicy {
  policyId: string;
  enabled: boolean;
  maxAttempts: number;
  retryPolicy: ModelRetryPolicy;
  cooldownSeconds: number;
  fallbackDeploymentIds: string[];
  contextWindowFallbackDeploymentIds?: string[];
  contentPolicyFallbackDeploymentIds?: string[];
}
```

### 3.5 Selection / Attempt Plan

```ts
interface ModelSelectRequest {
  requestId: string;
  correlationId: string;
  actor: ModelActor;
  scope: ModelScope;
  purpose: ModelTask;
  requiredCapabilities: Partial<ModelCapability>;
  preferredDeploymentIds?: string[];
  policyId?: string;
  fallbackAllowed: boolean;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
}

interface ModelAttempt {
  attemptId: string;
  providerId: string;
  deploymentId: string;
  model: string;
  endpointRef?: string;
  credentialRef: string;
  timeoutMs?: number;
  retryPolicy?: ModelRetryPolicy;
  capability: ModelCapability;
}

interface ModelSelection {
  requestId: string;
  strategy: ModelRoutingPolicy["strategy"];
  attempts: ModelAttempt[];
  selectedAttemptId: string;
  auditRefs: string[];
}
```

### 3.6 Usage / Trace

```ts
interface ModelUsageRecord {
  usageId: string;
  requestId: string;
  correlationId: string;
  actor: ModelActor;
  scope: ModelScope;
  providerId: string;
  deploymentId: string;
  model: string;
  task: ModelTask;
  status: "success" | "failed" | "fallback" | "cancelled";
  inputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
  audioSeconds?: number;
  latencyMs: number;
  estimatedCost?: number;
  errorClass?: string;
  createdAt: string;
}

interface ModelInvocationTrace {
  traceId: string;
  requestId: string;
  attempts: Array<{
    attemptId: string;
    deploymentId: string;
    status: "planned" | "started" | "success" | "failed" | "skipped";
    startedAt?: string;
    endedAt?: string;
    errorClass?: string;
    cooldownApplied?: boolean;
  }>;
}
```

### 3.7 Capability Export

```ts
interface ModelCapabilityExport {
  exportId: string;
  deploymentId: string;
  task: ModelTask;
  displayName: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  parameterSchema: Record<string, ModelParameterSchema>;
  requiredPolicyActions: string[];
  status: "active" | "disabled";
}
```

## 4. 存储布局

P0 先使用单机本地文件存储，接口按 repository 抽象，后续可以迁移到 SQLite 或独立服务。

```text
state/model-hub/
  providers/
    <provider-id>.json
  credentials/
    <credential-ref>.json
  deployments/
    <deployment-id>.json
  routing-policies/
    <policy-id>.json
  fallback-policies/
    <policy-id>.json
  capability-exports/
    <export-id>.json
  health-events.jsonl
  usage-records.jsonl
  invocation-traces.jsonl
  cooldown-state.json
  model-list-refresh-runs.jsonl
```

规则：

- `credentials/*.json` 只保存 secret metadata 和 secret store ref，不保存 secret 明文。
- `usage-records.jsonl` 不保存 prompt/output 正文。
- `invocation-traces.jsonl` 记录 attempt 和错误类别，不记录敏感输入。
- 本地模型下载缓存和生成文件归资源中心，不归 MH 直接管理。

## 5. 管理面 API

| API | 调用方 | 作用 |
| --- | --- | --- |
| `mh.providers.list` | UI / admin | 查看 provider |
| `mh.providers.add` | UI | 添加 provider config |
| `mh.providers.probe` | UI / scheduler | 探测 provider |
| `mh.credentials.status` | UI / governance | 查看 credential 状态 |
| `mh.deployments.list` | UI / runtime / CH / tools | 查看可用 deployment |
| `mh.deployments.refresh` | UI / scheduler | 刷新模型列表 |
| `mh.routing.updatePolicy` | UI | 更新固定/轮流/随机策略 |
| `mh.fallback.updatePolicy` | UI | 更新失败切换策略 |
| `mh.selectModel` | runtime / CH / tools | 获取 attempt plan |
| `mh.recordUsage` | runtime / CH / tools | 记录用量 |
| `mh.health.logs` | UI / diagnostics | 查看健康日志 |
| `mh.usage.query` | UI / diagnostics | 查看用量摘要 |
| `mh.exports.list` | tools / UI | 查看可封装成工具的模型能力 |

## 6. 核心流程

### 6.1 Provider 注册

1. UI 提交 provider kind、baseUrl、credential、scope。
2. Credential Registry 写入 secretRef。
3. Provider Registry 写入 provider。
4. Health Monitor probe provider。
5. Deployment Registry refresh model list。
6. Diagnostics 写 provider-created 和 probe result。

### 6.2 模型选择

1. 调用方提交 `ModelSelectRequest`。
2. 治理中心检查 scope、purpose、provider/deployment 可用权限。
3. Deployment Registry 过滤 task 和 capability。
4. Routing Engine 根据 fixed/round-robin/random 选择主 attempt。
5. Fallback Manager 附加 fallback attempts，并排除 cooldown/disabled/no-permission deployment。
6. 返回 `ModelSelection`。
7. 写 invocation trace planned 事件。

### 6.3 失败切换

1. Runtime 或调用方执行 attempt。
2. 失败后回报 `recordUsage` 或 `recordAttemptFailure`。
3. Fallback Manager 根据 error class 更新 cooldown。
4. 如果 fallbackAllowed 且 plan 仍有 attempts，调用方执行下一 attempt。
5. 最终结果写 usage 和 trace。

硬规则：

- 失败切换不能选择未授权 deployment。
- credentialRef 只能由主进程模型调用层解析。
- 工具中心拿到的是 capability export，不是 provider secret。

### 6.4 模型能力封装为工具

1. 工具中心调用 `mh.exports.list`。
2. MH 返回可封装能力和 input/output/parameter schema。
3. 工具中心创建 ToolDefinition，并绑定 `ModelCapabilityExport.exportId`。
4. 工具执行时仍调用 MH `selectModel`，再由受控模型调用层执行。
5. 用量和 trace 回写 MH。

例子：

- `image-generation` export -> 生成图片工具。
- `speech-to-text` export -> 音频转写工具。
- `vision` export -> 图片理解工具。
- `embedding` export -> CH 内部索引能力，不一定显示给终端用户。

## 7. 适配器合同

```ts
interface ModelProviderAdapter {
  providerId: string;
  listModels(request: ProviderModelListRequest): Promise<ModelDeployment[]>;
  probe(request: ProviderProbeRequest): Promise<ModelHealthCheck>;
  invoke?(request: ModelInvokeRequest): AsyncIterable<ModelInvocationEvent>;
}

interface LocalModelProviderAdapter extends ModelProviderAdapter {
  listLocalModels(request: LocalModelListRequest): Promise<LocalModelSummary[]>;
  pullModel(request: LocalModelPullRequest): AsyncIterable<LocalModelPullEvent>;
  deleteModel(request: LocalModelDeleteRequest): Promise<void>;
  listRunning(request: LocalModelProcessRequest): Promise<LocalModelProcess[]>;
}
```

P0 adapter：

- `OpenAICompatibleProviderAdapter`
- `AnthropicProviderAdapter` 或现有 Claude provider 映射
- `OllamaProviderAdapter`
- `CustomEndpointProviderAdapter`

后续 adapter：

- `StableDiffusionProviderAdapter`
- `ComfyUIProviderAdapter`
- `VLLMProviderAdapter`
- `LMStudioProviderAdapter`
- `DiffusersProviderAdapter`

## 8. UI / 可见性

P0 管理面至少包含：

- Providers：名称、类型、baseUrl、credential status、last probe、last error。
- Deployments：模型、task、modality、capabilities、status、context window、cost。
- Routing：固定/轮流/随机、目标 deployment、当前轮询位置。
- Fallback：是否启用、attempt 顺序、cooldown、失败原因。
- Usage：调用次数、成功率、tokens、latency、estimated cost。
- Exports：哪些模型能力可被工具中心封装。

## 9. 清理与保留策略

| 数据 | 默认保留 | 清理方式 |
| --- | --- | --- |
| health-events | 30 天 | 摘要压缩 |
| usage-records | 180 天 | 脱敏聚合后清理 |
| invocation-traces | 30 天 | 保留 attempt 摘要 |
| cooldown-state | 到期自动清理 | scheduler 清理 |
| model-list-refresh-runs | 90 天 | 保留摘要 |
| local generated outputs | 由资源中心管理 | 资源中心策略 |

## 10. 迁移路径

### 阶段一：单机版 facade

- 在 `QuarkfanTools-Single/` 内新增 `ModelHub` facade。
- 迁移现有 MODEL PROVIDER 配置。
- 保持现有 runtime 行为不变。

### 阶段二：路由和失败切换

- 落 fixed / round-robin / random。
- 增加 fallback toggle、attempt plan、cooldown。
- Runtime 使用 MH selection，而不是自行挑 provider。

### 阶段三：健康与用量

- 增加 provider probe、model list refresh。
- 记录 usage、latency、tokens、estimated cost。
- UI 展示 health 和 fallback attempts。

### 阶段四：工具封装接口

- 增加 `ModelCapabilityExport`。
- 工具中心按 export 封装 image/vision/TTS/STT 等模型能力。
- 治理中心检查工具执行和模型入模权限。

### 阶段五：本地与自托管增强

- 接 Ollama list/status/ps。
- 评估 LM Studio、vLLM、ComfyUI、Diffusers。
- 按资源中心策略管理本地模型资产和生成文件。

## 11. 测试矩阵

| 类型 | 场景 | 期望 |
| --- | --- | --- |
| Provider | 缺 credential | provider needs-auth |
| Provider | baseUrl 不可达 | probe failed，有 lastError |
| Deployment | 模型能力不满足 requiredCapabilities | 不进入 candidates |
| Routing | round-robin 多 deployment | 连续请求轮换 |
| Routing | random 多 deployment | 只在授权 deployment 中随机 |
| Fallback | 主 deployment rate-limit | cooldown 后尝试下一个 |
| Fallback | fallback disabled | 不生成后续 attempt |
| Security | runtime 获取 selection | 只含 credentialRef，不含 secret |
| Usage | 成功调用 | 记录 tokens/latency/cost/status |
| Usage | 失败调用 | 记录 errorClass 和 attempt |
| Tools | image-generation export | 工具中心可读取 schema，但拿不到 secret |
| Diagnostics | 导出排障包 | 不含 prompt/output/secret 明文 |

## 12. 验收标准

P0 可认为完成，当且仅当：

1. 现有 MODEL PROVIDER 配置通过 MH DTO 管理。
2. Runtime 获取模型只能通过 MH `selectModel`。
3. 支持固定、轮流、随机策略。
4. 支持失败切换开关和 cooldown。
5. provider/deployment/credential/health/usage 在 UI 或日志中可见。
6. 模型能力按 task/modality 描述，不再只按 LLM 文本模型描述。
7. 工具中心可以读取 `ModelCapabilityExport` 并封装至少一种非 LLM 能力的设计合同。
8. diagnostics 不泄露 secret、prompt、output 或客户数据正文。

## 13. 当前建议

- P0 不要引入 LiteLLM proxy 作为运行依赖，但 DTO 和测试应贴近 LiteLLM Router 思路。
- P0 先把当前 provider 配置、策略和失败切换稳定下来，再扩展 diffusion/image/audio。
- `ModelCapabilityExport` 应尽早设计，因为它是 MH 与工具中心协作的关键接口。
- 本地模型管理先从 Ollama 检测和 list/status 做起，不要急于做 pull/delete UI。
