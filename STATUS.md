# Model Hub 当前状态

最后更新：2026-08-16

## 仓库定位

本仓库是 Model Hub（MH，模型枢纽）的独立仓库，父项目 `QuarkfanTools` 通过 submodule 引用。当前 `0.1.0` 已部署，完成 provider、路由、失败切换、健康检查和用量统计闭环。

## 当前事实来源

新 session 按顺序阅读：

1. `AGENTS.md`
2. `docs/model-hub.md`
3. `docs/boundary-and-exposure-reference.md`
4. `docs/implementation-blueprint.md`

父项目的中心边界、跨中心协议、参考矩阵、参考项目评估和 macOS/Linux 蓝图保存在父项目 `docs/` 与 `Reference-Projects/` 下；MH 仓库只保留 MH 自己的设计和实现合同。

## 已完成

- Server implementation `0.1.0`：Node.js 22、TypeScript、Fastify、PostgreSQL 和 Dockerfile。
- 已实现 Provider、Model Deployment、Routing Policy、固定/轮流/随机选择、失败切换、Provider probe、真实 invoke、usage/cost trace 和 Model Capability Export。
- 首批协议适配包括 OpenAI-compatible、Anthropic、Ollama、Stable Diffusion WebUI 和 custom HTTP；secret 只通过 credentialRef resolver 进入执行层。
- Memory repository 用于合同测试，PostgreSQL repository 通过独立 `mh` schema 持久化并使用原子 round-robin cursor。
- Provider、Model Deployment 和 Routing Policy 已提供显式 list/detail/create/update/delete API；更新不会创建错误 ID，删除 Provider/Deployment 时会检查下游依赖并返回 409。
- Dashboard 支持三类对象的新增、编辑、启停和删除；高级配置覆盖请求头、优先级/权重、模型能力、上下文窗口、价格和元数据。
- OpenAI、Anthropic、Ollama、Stable Diffusion 和 Custom HTTP 协议实现已登记为 Model Adapter 扩展；Provider probe 和 invoke 在调用前解析可运行扩展，统一管理面暴露能力、隔离、状态和日志。

- 模型中心正式命名为 Model Hub，简称 MH。
- 明确 MH 不只是大语言模型中心，而是各类模型服务的统一管理中心。
- 建立 `ModelProvider`、`ModelDeployment`、`ModelCapability`、`ModelRoutingPolicy`、`ModelFallbackPolicy`、`ModelCredentialRef`、`ModelInvocationTrace`、`LocalModelProvider`、`SelfHostedModelDeployment` 等核心概念。
- 明确 MH 与运行时中心、工具与能力中心、CH、资源中心、调度与系统基础中心、治理与安全中心的边界。
- 建立 P0 范围：OpenAI-compatible provider、Anthropic/provider 适配、Ollama 本地 provider 检测、固定/轮流/随机策略、失败切换、健康检查、用量记录和基础 UI。
- 完成第一轮源码级参考项目评估：LiteLLM、Ollama、vLLM、Open WebUI、Dify。评估记录保存在父项目 `Reference-Projects/evaluations/model-hub/`。
- 基于 LiteLLM、Dify、Open WebUI、Ollama、vLLM 的源码参考，建立 MH 边界与能力开放度分级：L0 内部秘密层、L1 内部执行层、L2 受控计划层、L3 管理可见层、L4 能力声明层。
- 建立可执行设计蓝图：P0 DTO、模块边界、存储布局、管理面 API、模型选择、路由、失败切换、用量记录、工具封装接口、UI 可见性、测试矩阵和验收标准。

## 下一步建议

1. 增加 provider model-list discovery、自动同步预览和变更确认。
2. 增加按成本、延迟、并发和健康冷却时间路由。
3. 继续补充 image generation / diffusion 方向源码级参考，优先 ComfyUI、AUTOMATIC1111 Stable Diffusion WebUI、InvokeAI、Diffusers。

## 验证

当前仓库验证：

```bash
npm install
npm run typecheck
npm test
npm run build
git diff --check
```

当前测试：5 项。
