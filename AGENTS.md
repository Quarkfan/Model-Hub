# Model Hub 协作约定

本仓库是 Model Hub（MH，模型枢纽）的独立仓库。当前阶段以本仓库文档为 MH 事实来源，父项目 QuarkfanTools 是集成方。改动前请先阅读：

1. `STATUS.md`
2. `docs/model-hub.md`
3. `docs/boundary-and-exposure-reference.md`
4. `docs/implementation-blueprint.md`

边界约定：

- MH 管理各类模型服务，不只管理大语言模型。范围包括 LLM、embedding、rerank、vision、speech-to-text、TTS、image generation、image editing、Stable Diffusion 类模型、本地模型、自托管推理服务和 OpenAI-compatible endpoint。
- MH 对外提供模型注册、能力描述、模型选择、路由、失败切换、健康检查、用量/成本统计、凭据引用、部署状态和模型调用治理所需的事实，不负责 Agent session、workspace、sandbox 或最终 prompt 构造。
- MH 对外能力开放必须遵守 `docs/boundary-and-exposure-reference.md` 的 L0-L4 分级；raw secret、解密 credential、provider private headers、prompt/output/customer data 不得越过允许层级。
- 工具与能力中心可以把 MH 中的模型能力封装成工具，但工具注册、工具授权、工具 UI 和工作流编排不属于 MH。
- 运行时中心可以消费 MH 的模型选择结果和尝试计划，但 MH 不直接执行 Agent runtime。
- CH 可以请求 embedding、rerank、summary、vision 等模型候选，但 CH 不绕过 MH 直接读取 provider credential。
- 原始 API Key、token、provider secret、用户 prompt、未脱敏输入输出和客户数据不得写入普通日志、评估文档或 diagnostics。
- 涉及平台总边界、跨中心接口或 QuarkfanTools 集成状态时，同步父项目对应文档。

决策协作：

- 顶级工程原则：如果某个部分已经有成熟、优秀、许可合适且可维护的开源实现，应先做认真评估，再决定复用、适配、借鉴或自研，不要默认自己造轮子。
- 复用开源不等于把开源项目完整抄进来；粒度可以很大，例如直接把整个开源项目作为依赖或子系统，也可以很小，例如只借鉴某个模块设计、接口模型、状态机、测试方法或少量许可允许的代码片段。选择粒度时必须同时考虑隔离、安全、交付、自包含、授权、性能、维护成本和产品边界。
- 最终产品和架构决策由 Dean 做出。
- 不涉及产品方向、仓库归属、发布范围、对外承诺或不可逆架构选择时，Codex 拥有独立判断和建议权。
- Codex 必须主动思考、主动发现问题、主动提出风险、取舍、替代方案和低风险改进建议；不能只被动执行明确指令。
