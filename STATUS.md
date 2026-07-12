# Model Hub 当前状态

最后更新：2026-07-12

## 仓库定位

本仓库是 Model Hub（MH，模型枢纽）的独立仓库，父项目 `QuarkfanTools` 通过 submodule 引用。当前阶段以文档和合同为事实来源，后续实现可以先在单机版内落 facade，再逐步迁移到本仓库。

## 当前事实来源

新 session 按顺序阅读：

1. `AGENTS.md`
2. `docs/model-hub.md`
3. `docs/boundary-and-exposure-reference.md`
4. `docs/implementation-blueprint.md`

父项目的中心边界、跨中心协议、参考矩阵、参考项目评估和 macOS/Linux 蓝图保存在父项目 `docs/` 与 `Reference-Projects/` 下；MH 仓库只保留 MH 自己的设计和实现合同。

## 已完成

- 模型中心正式命名为 Model Hub，简称 MH。
- 明确 MH 不只是大语言模型中心，而是各类模型服务的统一管理中心。
- 建立 `ModelProvider`、`ModelDeployment`、`ModelCapability`、`ModelRoutingPolicy`、`ModelFallbackPolicy`、`ModelCredentialRef`、`ModelInvocationTrace`、`LocalModelProvider`、`SelfHostedModelDeployment` 等核心概念。
- 明确 MH 与运行时中心、工具与能力中心、CH、资源中心、调度与系统基础中心、治理与安全中心的边界。
- 建立 P0 范围：OpenAI-compatible provider、Anthropic/provider 适配、Ollama 本地 provider 检测、固定/轮流/随机策略、失败切换、健康检查、用量记录和基础 UI。
- 完成第一轮源码级参考项目评估：LiteLLM、Ollama、vLLM、Open WebUI、Dify。评估记录保存在父项目 `Reference-Projects/evaluations/model-hub/`。
- 基于 LiteLLM、Dify、Open WebUI、Ollama、vLLM 的源码参考，建立 MH 边界与能力开放度分级：L0 内部秘密层、L1 内部执行层、L2 受控计划层、L3 管理可见层、L4 能力声明层。
- 建立可执行设计蓝图：P0 DTO、模块边界、存储布局、管理面 API、模型选择、路由、失败切换、用量记录、工具封装接口、UI 可见性、测试矩阵和验收标准。

## 下一步建议

1. 在单机版 `QuarkfanTools-Single/` 内先建立 `ModelHub` facade，不急于拆独立进程。
2. 将现有 MODEL PROVIDER 配置、轮流/随机、失败切换和 runtime model 参数映射到 MH P0 合同。
3. 按 `docs/boundary-and-exposure-reference.md` 的 L0-L4 分级实现 `selectModel`、diagnostics、usage 和 capability export，先保证 secret、prompt、output 不跨层泄露。
4. 增加 provider health、model list refresh、usage trace、fallback attempts 和 credential status UI。
5. 为 Tool & Capability Center 设计 `ModelCapabilityExport`，允许 Stable Diffusion、TTS、vision、embedding 等模型能力被封装为工具。
6. 继续补充 image generation / diffusion 方向源码级参考，优先 ComfyUI、AUTOMATIC1111 Stable Diffusion WebUI、InvokeAI、Diffusers。

## 验证

当前仓库暂无构建命令。文档阶段常规验证：

```bash
git diff --check
```
