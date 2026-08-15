import type {
  ChatMessage,
  ModelDeployment,
  ModelInvokeRequest,
  ModelProvider,
  ModelToolCall,
} from "./types.js";
import { HubError } from "./platform.js";
export type SecretResolver = (ref: string) => Promise<Record<string, unknown>>;
export const envSecretResolver =
  (
    env: NodeJS.ProcessEnv = process.env,
    fetcher: typeof fetch = fetch,
  ): SecretResolver =>
  async (ref) => {
    if (ref.startsWith("governance:")) {
      const [, tenantId, credentialId] = ref.split(":");
      if (!tenantId || !credentialId)
        throw new HubError(
          "INVALID_REQUEST",
          "Invalid Governance credential ref",
          400,
        );
      const response = await fetcher(
        `${env.GOVERNANCE_URL ?? "http://127.0.0.1:4108"}/v1/credentials/${encodeURIComponent(credentialId)}/resolve`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.INTERNAL_SERVICE_TOKEN ?? ""}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            tenantId,
            actorId: "model-hub",
            correlationId: crypto.randomUUID(),
          }),
        },
      );
      const body = (await response.json()) as any;
      const value = body?.data?.value;
      if (
        !response.ok ||
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      )
        throw new HubError(
          "UNAVAILABLE",
          "Governance credential is unavailable",
          503,
          true,
        );
      return value;
    }
    if (!ref.startsWith("env:"))
      throw new HubError(
        "UNSUPPORTED",
        `Unsupported credential ref: ${ref}`,
        400,
      );
    const raw = env[ref.slice(4)];
    if (!raw)
      throw new HubError(
        "UNAVAILABLE",
        `Credential is unavailable: ${ref}`,
        503,
        true,
      );
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new HubError(
        "INVALID_REQUEST",
        `Credential is not valid JSON: ${ref}`,
        500,
      );
    }
  };
export interface AdapterResult {
  output: unknown;
  finishReason?: string;
  inputTokens: number;
  outputTokens: number;
}
export class ProviderInvoker {
  constructor(
    private resolve: SecretResolver,
    private fetcher: typeof fetch = fetch,
  ) {}
  async credential(p: ModelProvider) {
    if (!p.credentialRef) return {};
    return this.resolve(p.credentialRef);
  }
  async probe(p: ModelProvider) {
    const c = await this.credential(p);
    const key = typeof c.apiKey === "string" ? c.apiKey : "";
    const path =
      p.protocol === "ollama"
        ? "/api/tags"
        : p.protocol === "stable-diffusion"
          ? "/sdapi/v1/options"
          : "/v1/models";
    const r = await this.fetcher(join(p.baseUrl, path), {
      headers: headers(p, key),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok)
      throw new HubError(
        "UPSTREAM_FAILED",
        `Provider probe failed (${r.status})`,
        502,
        true,
      );
    return { status: r.status };
  }
  async invoke(
    p: ModelProvider,
    d: ModelDeployment,
    input: ModelInvokeRequest,
  ): Promise<AdapterResult> {
    const c = await this.credential(p);
    const key = typeof c.apiKey === "string" ? c.apiKey : "";
    if (p.protocol === "anthropic") return this.anthropic(p, d, input, key);
    if (p.protocol === "ollama") return this.ollama(p, d, input);
    if (p.protocol === "stable-diffusion")
      return this.diffusion(p, d, input, key);
    if (p.protocol === "openai") return this.openai(p, d, input, key);
    return this.custom(p, d, input, key);
  }
  private async openai(
    p: ModelProvider,
    d: ModelDeployment,
    i: ModelInvokeRequest,
    key: string,
  ) {
    let path = "/v1/chat/completions";
    let body: Record<string, unknown> = {
      model: d.modelId,
      messages: (
        i.messages ?? [
          { role: "user", content: i.prompt ?? String(i.input ?? "") },
        ]
      ).map(openAiMessage),
      temperature: i.temperature,
      max_tokens: i.maxTokens,
      tools: i.tools,
      response_format: i.responseFormat,
    };
    if (d.kind === "embedding") {
      path = "/v1/embeddings";
      body = { model: d.modelId, input: i.input ?? i.prompt };
    } else if (d.kind === "image-generation" || d.kind === "image-edit") {
      path = "/v1/images/generations";
      body = { model: d.modelId, prompt: i.prompt ?? i.input, n: 1 };
    } else if (d.kind === "text-to-speech") {
      path = "/v1/audio/speech";
      body = {
        model: d.modelId,
        input: i.prompt ?? i.input,
        voice: d.metadata.voice ?? "alloy",
      };
    }
    const r = await this.fetcher(join(p.baseUrl, path), {
      method: "POST",
      headers: { ...headers(p, key), "content-type": "application/json" },
      body: JSON.stringify(clean(body)),
      signal: AbortSignal.timeout(120000),
    });
    if (d.kind === "text-to-speech" && r.ok)
      return {
        output: {
          contentType: r.headers.get("content-type"),
          base64: Buffer.from(await r.arrayBuffer()).toString("base64"),
        },
        inputTokens: 0,
        outputTokens: 0,
      };
    const j = await readJson(r);
    assertOk(r, j);
    const usage = obj(j.usage);
    if (d.kind === "embedding")
      return {
        output: obj((j.data as unknown[])?.[0]).embedding ?? j.data,
        inputTokens: num(usage.prompt_tokens),
        outputTokens: 0,
      };
    if (d.kind.startsWith("image"))
      return { output: j.data, inputTokens: 0, outputTokens: 0 };
    const choice = obj((j.choices as unknown[])?.[0]),
      message = obj(choice.message),
      toolCalls = Array.isArray(message.tool_calls)
        ? message.tool_calls.map(openAiToolCall).filter(Boolean)
        : [];
    return {
      output: toolCalls.length
        ? { type: "assistant", text: str(message.content), toolCalls }
        : (message.content ?? choice.text ?? choice.message),
      finishReason: str(choice.finish_reason) || undefined,
      inputTokens: num(usage.prompt_tokens),
      outputTokens: num(usage.completion_tokens),
    };
  }
  private async anthropic(
    p: ModelProvider,
    d: ModelDeployment,
    i: ModelInvokeRequest,
    key: string,
  ) {
    const source = i.messages ?? [
        { role: "user" as const, content: i.prompt ?? String(i.input ?? "") },
      ],
      messages = source
        .filter((m) => m.role !== "system")
        .map(anthropicMessage),
      system =
        source
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n") || undefined,
      tools = i.tools?.map(anthropicTool);
    const r = await this.fetcher(join(p.baseUrl, "/v1/messages"), {
      method: "POST",
      headers: {
        ...headers(p, key),
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(
        clean({
          model: d.modelId,
          messages,
          system,
          max_tokens: i.maxTokens ?? 4096,
          temperature: i.temperature,
          tools,
        }),
      ),
      signal: AbortSignal.timeout(120000),
    });
    const j = await readJson(r);
    assertOk(r, j);
    const usage = obj(j.usage),
      content = Array.isArray(j.content) ? j.content : [],
      toolCalls = content
        .filter((x) => obj(x).type === "tool_use")
        .map((x) => ({
          id: str(obj(x).id),
          name: str(obj(x).name),
          input: obj(obj(x).input),
        })),
      text = content
        .filter((x) => obj(x).type === "text")
        .map((x) => str(obj(x).text))
        .filter(Boolean)
        .join("\n");
    return {
      output: toolCalls.length
        ? { type: "assistant", text, toolCalls }
        : text || j,
      finishReason: str(j.stop_reason) || undefined,
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
    };
  }
  private async ollama(
    p: ModelProvider,
    d: ModelDeployment,
    i: ModelInvokeRequest,
  ) {
    const r = await this.fetcher(join(p.baseUrl, "/api/chat"), {
      method: "POST",
      headers: { ...p.headers, "content-type": "application/json" },
      body: JSON.stringify({
        model: d.modelId,
        messages: i.messages ?? [
          { role: "user", content: i.prompt ?? String(i.input ?? "") },
        ],
        stream: false,
        tools: i.tools,
      }),
      signal: AbortSignal.timeout(120000),
    });
    const j = await readJson(r);
    assertOk(r, j);
    const message = obj(j.message),
      toolCalls = Array.isArray(message.tool_calls)
        ? message.tool_calls
            .map((x, index) => ollamaToolCall(x, index))
            .filter(Boolean)
        : [];
    return {
      output: toolCalls.length
        ? { type: "assistant", text: str(message.content), toolCalls }
        : (message.content ?? j.message),
      finishReason: str(j.done_reason) || undefined,
      inputTokens: num(j.prompt_eval_count),
      outputTokens: num(j.eval_count),
    };
  }
  private async diffusion(
    p: ModelProvider,
    d: ModelDeployment,
    i: ModelInvokeRequest,
    key: string,
  ) {
    const r = await this.fetcher(join(p.baseUrl, "/sdapi/v1/txt2img"), {
      method: "POST",
      headers: { ...headers(p, key), "content-type": "application/json" },
      body: JSON.stringify({
        prompt: i.prompt ?? i.input,
        override_settings: { sd_model_checkpoint: d.modelId },
        ...(typeof i.input === "object" ? i.input : {}),
      }),
      signal: AbortSignal.timeout(300000),
    });
    const j = await readJson(r);
    assertOk(r, j);
    return {
      output: { images: j.images, info: j.info },
      inputTokens: 0,
      outputTokens: 0,
    };
  }
  private async custom(
    p: ModelProvider,
    d: ModelDeployment,
    i: ModelInvokeRequest,
    key: string,
  ) {
    const r = await this.fetcher(
      join(p.baseUrl, str(d.metadata.invokePath) || "/invoke"),
      {
        method: "POST",
        headers: { ...headers(p, key), "content-type": "application/json" },
        body: JSON.stringify({ model: d.modelId, ...i }),
        signal: AbortSignal.timeout(300000),
      },
    );
    const j = await readJson(r);
    assertOk(r, j);
    return {
      output: j.output ?? j,
      inputTokens: num(obj(j.usage).inputTokens),
      outputTokens: num(obj(j.usage).outputTokens),
    };
  }
}
const openAiMessage = (m: ChatMessage) =>
  clean({
    role: m.role,
    content: m.content,
    name: m.name,
    tool_call_id: m.toolCallId,
    tool_calls: m.toolCalls?.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.input) },
    })),
  });
const openAiToolCall = (value: unknown): ModelToolCall | undefined => {
  const call = obj(value),
    fn = obj(call.function),
    id = str(call.id),
    name = str(fn.name);
  if (!id || !name) return;
  let input: Record<string, unknown> = {};
  try {
    input =
      typeof fn.arguments === "string"
        ? obj(JSON.parse(fn.arguments))
        : obj(fn.arguments);
  } catch {
    input = { _raw: str(fn.arguments) };
  }
  return { id, name, input };
};
const anthropicMessage = (m: ChatMessage) => {
  if (m.role === "tool")
    return {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: m.toolCallId, content: m.content },
      ],
    };
  if (m.role === "assistant" && m.toolCalls?.length)
    return {
      role: "assistant",
      content: [
        ...(m.content ? [{ type: "text", text: m.content }] : []),
        ...m.toolCalls.map((call) => ({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.input,
        })),
      ],
    };
  return { role: m.role, content: m.content };
};
const anthropicTool = (value: Record<string, unknown>) => {
  const fn = obj(value.function);
  return {
    name: str(fn.name),
    description: str(fn.description),
    input_schema: obj(fn.parameters),
  };
};
const ollamaToolCall = (
  value: unknown,
  index: number,
): ModelToolCall | undefined => {
  const call = obj(value),
    fn = obj(call.function),
    name = str(fn.name);
  if (!name) return;
  return {
    id: str(call.id) || `ollama-${index}`,
    name,
    input: obj(fn.arguments),
  };
};
const join = (base: string, path: string) =>
  `${base.replace(/\/$/, "")}${path}`;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const obj = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {};
const clean = (v: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
const headers = (p: ModelProvider, key: string) => ({
  ...p.headers,
  ...(key ? { authorization: `Bearer ${key}` } : {}),
});
async function readJson(r: Response) {
  try {
    return obj(await r.json());
  } catch {
    return {};
  }
}
function assertOk(r: Response, j: Record<string, any>) {
  if (!r.ok)
    throw new HubError(
      r.status === 429 ? "RATE_LIMITED" : "UPSTREAM_FAILED",
      `Provider request failed (${r.status})`,
      r.status === 429 ? 429 : 502,
      r.status >= 500 || r.status === 429,
      {
        providerCode: str(obj(j.error).code) || str(j.code),
        providerMessage: str(obj(j.error).message) || str(j.message),
      },
    );
}
