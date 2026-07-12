# Model Hub（MH，模型枢纽）设计

本文定义 QuarkfanTools 的 Model Hub，简称 MH。MH 是平台八个中心之一，替代原“模型中心”命名。原因是该中心未来承载的不只是大语言模型 provider，也包括 embedding、rerank、vision、speech、TTS、image generation、image editing、Stable Diffusion 类模型、本地模型、自托管推理服务和 OpenAI-compatible endpoint。

## 1. 定位

MH 负责管理“平台可以合法、稳定、可观测地使用哪些模型服务”。这里的模型包括：

- 文本模型：chat、agent、completion、reasoning、structured output。
- 向量与检索模型：embedding、rerank、classification、moderation。
- 视觉模型：image understanding、OCR、document vision、multimodal。
- 语音模型：speech-to-text、text-to-speech、voice clone、audio understanding。
- 图像生成模型：image generation、image editing、inpaint、upscale、Stable Diffusion、Flux、ComfyUI workflow。
- 本地模型：Ollama、LM Studio、llama.cpp、MLX、桌面 OpenAI-compatible endpoint。
- 自托管推理：vLLM、TGI、SGLang、Ray Serve、KServe、NVIDIA NIM、OpenAI-compatible serving。
- 托管 provider：OpenAI、Anthropic、Gemini、Azure OpenAI、Bedrock、OpenRouter、Moonshot、DeepSeek、DashScope 等。

MH 对外提供的是“模型能力发现、模型选择、尝试计划、调用审计和用量记录”，不是 Agent runtime，也不是工具执行器。

## 2. 设计目标

MH 的核心目标：

1. 统一管理不同模型 provider、credential、endpoint、deployment 和 alias。
2. 统一描述模型能力，而不是把所有模型都当成 chat LLM。
3. 支持固定、轮流、随机、失败切换，以及未来的成本/延迟/健康/负载感知路由。
4. 对运行时、CH、工具中心和调度中心提供可用模型候选和 attempt plan。
5. 对本地模型和自托管模型提供健康检查、资源状态、运行状态和可见日志。
6. 记录 token、耗时、成本、错误、fallback、成功率和 trace。
7. 支持工具中心把模型能力封装为工具，但保持工具授权和工具编排在工具中心。

MH 必须满足：

- 不能把 provider credential 暴露给 runtime workspace、Skill、自定义应用或工具执行环境。
- 不能把模型调用和 Agent session 混成一个系统。
- 不能默认所有模型都支持 tools、vision、streaming 或 JSON/schema。
- 不能让失败切换越过 Bot、owner、workspace 或策略授权边界。
- 不能把用户 prompt、图片、音频、客户数据原文写入普通用量日志。

## 3. 参考项目策略

当前已完成第一轮源码级参考：

- LiteLLM：provider abstraction、Router、fallback、cooldown、retry、budget、spend、virtual key、management API。
- Ollama：local model list/pull/run/status、OpenAI-compatible local adapter、process visibility。
- vLLM：self-hosted OpenAI-compatible serving、scheduler capacity、metrics、deployment config。
- Open WebUI：model config UI、model access grants、provider proxying、base model wrapping。
- Dify：provider/model status、credential configuration、load balancing、model type separation。

后续建议补充 image generation / diffusion 方向参考：

| 方向 | 候选项目 | 重点看什么 |
| --- | --- | --- |
| Node graph image workflow | ComfyUI | workflow graph、node capabilities、model/checkpoint/LoRA/resource refs |
| Stable Diffusion WebUI | AUTOMATIC1111 | model catalog、sampler/options、API、extension ecosystem |
| Diffusion app/server | InvokeAI | model manager、queue、board/gallery、workflow persistence |
| Library reference | Diffusers | pipeline abstraction、scheduler、adapter、local model assets |
| Self-hosted serving | vLLM / TGI / SGLang | endpoint compatibility、capacity、metrics、health |

使用原则：

- LiteLLM 是 MH 路由和 provider 管理的主参考，但 P0 不要求运行 LiteLLM proxy。
- Ollama 是本地模型 provider 的主参考，但 P0 不嵌入 Ollama runtime。
- vLLM 是自托管推理部署参考，不进入桌面 P0 依赖。
- Diffusion 类项目重点借鉴能力描述、参数 schema、资源引用和工具封装方式，不把图像工作流系统塞进 MH。

## 4. 核心概念

### 4.1 ModelProvider

`ModelProvider` 是模型服务来源，可以是云厂商、本地 runtime、自托管 endpoint 或第三方聚合网关。

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
  status: "active" | "disabled" | "needs-auth" | "failed";
  supportedModalities: ModelModality[];
  createdAt: string;
  updatedAt: string;
}
```

### 4.2 ModelDeployment

`ModelDeployment` 是实际可调用的模型部署单元。

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
  createdAt: string;
  updatedAt: string;
}
```

### 4.3 ModelCapability

```ts
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
  maxInputTokens?: number;
  maxOutputTokens?: number;
  contextWindow?: number;
  supportedParameters?: Record<string, ModelParameterSchema>;
}
```

### 4.4 ModelRoutingPolicy

```ts
interface ModelRoutingPolicy {
  policyId: string;
  name: string;
  scope: ModelScope;
  strategy: "fixed" | "round-robin" | "random" | "least-busy" | "lowest-cost" | "lowest-latency";
  deploymentIds: string[];
  fallbackPolicyId?: string;
  enabled: boolean;
}
```

### 4.5 ModelFallbackPolicy

```ts
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

### 4.6 ModelCapabilityExport

`ModelCapabilityExport` 是 MH 给工具中心的能力声明。工具中心可以把它封装为工具，但模型本身仍由 MH 管理。

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
}
```

例子：

- Stable Diffusion image generation export -> 工具中心封装为“生成图片”工具。
- OCR vision export -> 工具中心封装为“识别图片文字”工具。
- TTS export -> 工具中心封装为“生成语音”工具。
- Embedding export -> CH 用于索引，不一定展示为用户工具。

## 5. 与其他中心关系

| 中心 | 关系 |
| --- | --- |
| 运行时中心 | 消费 MH 的 `ModelSelection` / `ModelAttemptPlan`；不直接读取 provider credential |
| CH | 请求 embedding、rerank、summary、vision 等模型候选；用量回写 MH |
| 工具与能力中心 | 可把 `ModelCapabilityExport` 封装成工具；工具权限和 UI 属于工具中心 |
| 资源中心 | 保存模型缓存、下载进度、诊断包、生成图片/音频文件和本地模型资产引用 |
| 调度与系统基础中心 | 定期 health check、model list refresh、usage aggregation、cleanup |
| 治理与安全中心 | 判定模型可用范围、敏感数据能否入模、凭据可见性、导出权限 |
| MG | 不直接依赖 MH；消息触发的任务经调度/运行时再请求模型 |

## 6. P0 建设范围

P0 包含：

- MH 命名和协议收口。
- Provider / Deployment / Capability / Routing / Fallback / Usage / Trace DTO。
- OpenAI-compatible provider adapter。
- Anthropic 或现有 Claude 相关 provider 配置映射。
- Ollama local provider 检测、list、status。
- 固定、轮流、随机策略。
- 失败切换开关、attempt plan、cooldown state。
- 基础健康检查和 model list refresh。
- 用量记录：provider、model、task、latency、tokens、estimated cost、success/failure。
- UI：provider 列表、deployment 列表、credential 状态、routing policy、fallback toggle、health/logs。

P0 暂不包含：

- 内置 Stable Diffusion runtime。
- 内置 vLLM server。
- 完整成本计费系统。
- 自动购买/充值/额度管理。
- 复杂 workload scheduler。
- 把任意模型能力自动发布为工具，必须经过工具中心和治理。

## 7. 下一步

1. 基于本文和源码评估收口 MH P0 合同文档。
2. 在单机版中建立 `ModelHub` facade。
3. 将现有 MODEL PROVIDER UI 与配置迁移到 MH DTO。
4. 增加 `ModelCapabilityExport` 与工具中心接口草案。
5. 补充 diffusion/image generation 参考项目评估。
