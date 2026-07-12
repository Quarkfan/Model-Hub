# Model Hub Boundary and Exposure Reference

本文定义 Model Hub（MH）的边界和能力开放度。它补充 `model-hub.md` 和
`implementation-blueprint.md`：前者说明 MH 是什么，后者说明 P0 怎么建；本文专门说明
哪些能力可以开放给其他中心、UI、诊断和工具中心，哪些能力必须留在 MH 内部。

## 1. 参考依据

本文件基于源码级参考，而不是只基于 README：

| 项目 | 已参考位置 | 对 MH 的启发 |
| --- | --- | --- |
| LiteLLM | `litellm/types/router.py`、`tests/local_testing/test_router_fallbacks.py` | routing policy、fallback、retry、cooldown、deployment group 和 usage/cost 语义 |
| Dify | `api/core/entities/provider_configuration.py`、`api/core/entities/model_entities.py` | provider status、credential status、model type、quota、no-permission、load balancing 和 credential policy |
| Open WebUI | `backend/open_webui/utils/models.py`、`backend/open_webui/models/access_grants.py` | UI-facing model record、base model wrapping、capability metadata、access grants、从模型列表移除敏感 params |
| Ollama | `api/types.go`、`server/routes.go` | local model list、running process、VRAM/context/keep-alive、pull/delete/progress 的开放边界 |
| vLLM | `vllm/v1/metrics/stats.py`、`vllm/v1/metrics/loggers.py`、OpenAI entrypoint tests | self-hosted deployment capacity、scheduler metrics、KV cache、stream usage、LoRA/resource 状态 |

参考原则：

- LiteLLM 是路由和 fallback 主参考，但不把 LiteLLM proxy 作为 P0 运行依赖。
- Dify 是 provider/model 状态和 credential 分层参考，但不复制 tenant/app/workflow 形态。
- Open WebUI 是模型 UI 与 access grants 参考，但不把 chat workspace 或工具编排放进 MH。
- Ollama 是本地模型 provider 参考，但 P0 只接入检测、list、status，不内置 runtime。
- vLLM 是自托管 serving 和 metrics 参考，不进入桌面 P0 依赖。

## 2. 开放度分级

MH 的开放度按五层划分。新增接口或 UI 字段必须先归类。

| 层级 | 名称 | 可见对象 | 允许调用方 | 例子 |
| --- | --- | --- | --- | --- |
| L0 | 内部秘密层 | raw secret、provider API key、解密后的 credential、完整上游请求体 | 仅主进程受控模型调用层 | `ANTHROPIC_AUTH_TOKEN`、OpenAI key、provider 私有 header |
| L1 | 内部执行层 | executable adapter、真实 endpoint、request payload、retry/cooldown 写状态 | MH 内部、受控模型调用层 | adapter invoke、cooldown-state 写入、provider-specific invoke params |
| L2 | 受控计划层 | attempt plan、credentialRef、endpointRef、capability summary、policy/audit refs | runtime、CH、工具中心、scheduler | `mh.selectModel` 返回的 `ModelSelection` |
| L3 | 管理可见层 | provider/deployment/health/status/usage 摘要、masked credential status | UI、diagnostics、admin | provider 列表、last probe、usage summary、health logs |
| L4 | 能力声明层 | 可被封装的 task/schema/parameter schema、required policy action | 工具与能力中心、UI | `ModelCapabilityExport` |

硬规则：

- L0 不能进入 `ModelSelection`、capability export、diagnostics、普通日志或 runtime workspace。
- L1 不能被 Skill、自定义应用、MCP server 或 Agent workspace 直接调用。
- L2 可以跨中心传递，但只包含引用和计划，不包含可直接滥用的 secret 或完整 payload。
- L3 面向人可见，但 credential、prompt、output、图片、音频和客户数据必须脱敏或只显示摘要。
- L4 只声明能力，不自动创建工具；工具注册、工具授权和工作流编排仍归工具与能力中心。

## 3. 能力开放矩阵

| 能力 | P0 开放度 | 对外接口 | 内部保留 | 参考依据 |
| --- | --- | --- | --- | --- |
| Provider 注册 | L3 管理可见，L1 执行保留 | `mh.providers.add/list/probe` | raw secret、adapter invoke params | Dify provider configuration、Open WebUI provider config |
| Credential 状态 | L3 masked status | `mh.credentials.status` | secret 明文、解密结果、credential policy internals | Dify credential policy 和 masked credentials |
| Deployment 列表 | L2/L3 | `mh.deployments.list/refresh` | provider-specific raw params | LiteLLM model list、Open WebUI model info |
| Capability 描述 | L2/L4 | `mh.deployments.list`、`mh.exports.list` | 自动发布为工具的决策 | Open WebUI capability metadata、Dify model type |
| 模型选择 | L2 | `mh.selectModel` | routing state 写入、secret resolve | LiteLLM Router、Dify load balancing |
| Fallback / retry | L2 计划，L3 可见摘要 | attempt plan、fallback logs | cooldown 写状态、error-class 分类细节 | LiteLLM retry/cooldown tests |
| Health check | L3 | `mh.providers.probe`、`mh.health.logs` | 探针 secret、原始请求体 | LiteLLM health cache、Ollama status/list |
| Usage / cost | L3 摘要，L2 record | `mh.recordUsage`、`mh.usage.query` | prompt/output/customer data | LiteLLM spend tracking、vLLM usage chunks |
| Local model list/status | L3 | Ollama adapter list/status/ps | pull/delete 默认不开 | Ollama `ListResponse`、`ProcessResponse` |
| Local model pull/delete | P0 不开放；P1+ L3 受控操作 | future `mh.localModels.pull/delete` | 大文件下载、磁盘清理、取消、资源中心联动 | Ollama pull/delete/progress |
| Self-hosted metrics | P1+ L3 摘要 | future deployment metrics | scheduler internals、engine config | vLLM scheduler/KV metrics |
| Capability export | L4 | `mh.exports.list/get` | 工具 UI、工具权限、workflow | MH 与工具中心边界 |

## 4. 边界判定规则

### 4.1 MH 可以决定

- 哪些 provider / deployment 当前可用。
- 某个 task 所需 capability 是否被满足。
- 固定、轮流、随机、未来 least-busy / cost-aware / latency-aware 的候选顺序。
- 某个失败类型是否触发 retry、fallback 或 cooldown。
- 某个 deployment 的健康状态、credential status、quota/status 摘要。
- 模型调用的 usage、latency、tokens、cost estimate 和 error class 如何记账。
- 哪些模型能力可以声明为 `ModelCapabilityExport`。

### 4.2 MH 不可以决定

- 是否运行 Agent、使用哪个 runtime、是否恢复 session。
- 最终 prompt、上下文拼接、工具注入、workspace 和 sandbox。
- 某个工具是否注册、展示、授权或进入 workflow。
- 某条消息是否要回复、补处理、投递到哪个 IM。
- CH 是否允许读取某个知识源或写入长期记忆。
- 用户内容、prompt、output、图片、音频或客户数据是否写入普通日志。

### 4.3 必须请求治理中心的场景

- `selectModel` 的 scope 涉及 bot / owner / workspace / capabilityRef。
- fallback 将跨 provider、跨 owner、跨 workspace 或跨本地/云端边界。
- 工具中心请求 `ModelCapabilityExport` 并准备封装成可执行工具。
- local-only、external-data、customer-data 等敏感策略影响模型选择。
- diagnostics 或 usage query 可能暴露 provider、成本、错误或客户数据摘要。

## 5. DTO 设计要求

### 5.1 对外 DTO 必须使用引用

`ModelSelection` 对外只返回：

- `providerId`
- `deploymentId`
- `model`
- `endpointRef`
- `credentialRef`
- `capability`
- `retryPolicy`
- `auditRefs`

不得返回：

- raw API key / token
- provider private headers
- decrypted credential
- full upstream request body
- prompt / output / image / audio body

### 5.2 Capability 不等于调用能力

`ModelCapability` 是事实描述，不能直接等同于授权。即使某 deployment 声明支持
`image-generation` 或 `tools`，调用方仍必须有：

- matching `ModelScope`
- governance allow decision
- required policy actions
- allowed task/purpose
- non-cooldown deployment status

### 5.3 Export 不等于 Tool

`ModelCapabilityExport` 只允许包含：

- task
- input/output schema
- parameter schema
- user-visible display name
- deployment or policy binding reference
- required policy actions

它不能包含：

- secret
- executable adapter
- provider raw params
- 自动生成的 ToolDefinition
- workflow step 或 UI placement

## 6. 实现开放度路线

### P0：保守开放

- 将现有 MODEL PROVIDER 配置映射成 provider/deployment/capability/routing/fallback DTO。
- Runtime 先消费 `selectModel` attempt plan，行为与当前 `modelProviderAttempts` 保持一致。
- UI 显示 provider、deployment、credential masked status、routing/fallback、health/usage 摘要。
- `ModelCapabilityExport` 先落设计和只读列表，可封装至少一种非 agent 能力的 schema。
- Ollama 只做 detect/list/status/ps，不做 pull/delete。

### P1：受控增强

- 增加 provider probe、model list refresh、cooldown state、usage ledger。
- 增加 local model pull/delete 的风险门槛：磁盘检查、进度、取消、资源中心清理、用户确认。
- 增加 self-hosted deployment health/metrics 摘要，但不暴露 scheduler internals。
- 增加 cost-aware / latency-aware 的只读指标，为策略做准备。

### P2：开放生态接口

- 工具中心可基于 `ModelCapabilityExport` 封装 image、vision、TTS、STT、embedding 等能力。
- 引入 optional LiteLLM-backed adapter 或 self-hosted provider adapter，但 DTO 仍由 MH 控制。
- diffusion / ComfyUI / Stable Diffusion 类能力只以 provider adapter + capability export 接入，不把 workflow engine 塞进 MH。

## 7. 验收清单

任何 MH 实现或接口变更必须满足：

- `selectModel` 不返回 secret 明文。
- fallback 不越过 scope、policy 和 deployment status。
- capability export 不自动注册工具。
- usage 和 trace 不保存 prompt/output/customer data。
- diagnostics 不含 raw secret、raw request body 或 provider private headers。
- local model 操作的 destructive / large download 能力默认不开，必须有用户可见状态和资源中心联动。
- UI 能解释 unavailable 的原因：missing credential、disabled、no permission、quota、cooldown、health failed。
- 测试覆盖：scope filtering、capability filtering、round-robin/random、fallback disabled/enabled、cooldown、masked diagnostics、export schema。
