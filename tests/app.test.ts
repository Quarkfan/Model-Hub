import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryModelRepository } from "../src/repository.js";
import { envSecretResolver } from "../src/adapters.js";

const token = "test-internal-token-that-is-at-least-32-characters";
const auth = { authorization: `Bearer ${token}` };

describe("Model Hub", () => {
  it("resolves governed provider credentials without exposing plaintext", async () => {
    let authorization = "";
    const resolver = envSecretResolver(
      {
        GOVERNANCE_URL: "http://governance:4108",
        INTERNAL_SERVICE_TOKEN: "internal",
      },
      (async (_url, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return new Response(
          JSON.stringify({ data: { value: { apiKey: "secret" } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    );
    await expect(resolver("governance:default:credential-a")).resolves.toEqual({
      apiKey: "secret",
    });
    expect(authorization).toBe("Bearer internal");
  });
  it("routes, fails over and records usage", async () => {
    const repo = new MemoryModelRepository();
    const fetcher: typeof fetch = async (url) =>
      String(url).startsWith("https://bad")
        ? new Response(JSON.stringify({ error: { message: "down" } }), {
            status: 503,
            headers: { "content-type": "application/json" },
          })
        : new Response(
            JSON.stringify({
              choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 4, completion_tokens: 2 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
    const app = buildApp({
      repository: repo,
      internalToken: token,
      secretResolver: async () => ({ apiKey: "secret" }),
      fetcher,
    });
    const create = async (url: string, payload: Record<string, unknown>) =>
      (await app.inject({ method: "POST", url, headers: auth, payload })).json()
        .data;
    const p1 = await create("/v1/providers", {
      name: "bad",
      protocol: "openai",
      baseUrl: "https://bad",
      credentialRef: "env:X",
    });
    const p2 = await create("/v1/providers", {
      name: "good",
      protocol: "openai",
      baseUrl: "https://good",
      credentialRef: "env:Y",
    });
    const d1 = await create("/v1/models", {
      providerId: p1.id,
      modelId: "m1",
      name: "m1",
      kind: "chat",
    });
    const d2 = await create("/v1/models", {
      providerId: p2.id,
      modelId: "m2",
      name: "m2",
      kind: "chat",
    });
    const policy = await create("/v1/routing-policies", {
      name: "main",
      mode: "fixed",
      deploymentIds: [d1.id, d2.id],
      fixedDeploymentId: d1.id,
      failoverOnFailure: true,
      maxAttempts: 2,
    });
    const result = await app.inject({
      method: "POST",
      url: "/v1/invoke",
      headers: auth,
      payload: {
        policyId: policy.id,
        kind: "chat",
        messages: [{ role: "user", content: "hello" }],
        correlationId: "corr",
      },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().data.output).toBe("ok");
    expect(result.json().data.attempts).toHaveLength(2);
    const usage = await app.inject({
      method: "GET",
      url: "/v1/usage/summary",
      headers: auth,
    });
    expect(
      usage
        .json()
        .data.reduce((n: number, x: { requests: number }) => n + x.requests, 0),
    ).toBe(2);
    await app.close();
  });

  it("keeps round robin selection state", async () => {
    const repo = new MemoryModelRepository();
    const app = buildApp({ repository: repo, internalToken: token });
    const create = async (url: string, payload: Record<string, unknown>) =>
      (await app.inject({ method: "POST", url, headers: auth, payload })).json()
        .data;
    const provider = await create("/v1/providers", {
      name: "local",
      protocol: "ollama",
      baseUrl: "http://ollama:11434",
    });
    const a = await create("/v1/models", {
      providerId: provider.id,
      modelId: "a",
      name: "a",
      kind: "chat",
    });
    const b = await create("/v1/models", {
      providerId: provider.id,
      modelId: "b",
      name: "b",
      kind: "chat",
    });
    const policy = await create("/v1/routing-policies", {
      name: "rr",
      mode: "round-robin",
      deploymentIds: [a.id, b.id],
    });
    const select = async () =>
      (
        await app.inject({
          method: "POST",
          url: "/v1/select",
          headers: auth,
          payload: { policyId: policy.id, kind: "chat" },
        })
      ).json().data.attempts[0].deploymentId;
    expect(await select()).toBe(a.id);
    expect(await select()).toBe(b.id);
    await app.close();
  });

  it("supports explicit CRUD and protects referenced model configuration", async () => {
    const repo = new MemoryModelRepository();
    const app = buildApp({ repository: repo, internalToken: token });
    const request = (
      method: "GET" | "POST" | "PUT" | "DELETE",
      url: string,
      payload?: Record<string, unknown>,
    ) =>
      app.inject({
        method,
        url,
        headers: auth,
        ...(payload ? { payload } : {}),
      });
    const create = async (url: string, payload: Record<string, unknown>) =>
      (await request("POST", url, payload)).json().data;
    const provider = await create("/v1/providers", {
      name: "editable",
      protocol: "openai",
      baseUrl: "https://models.example",
      credentialRef: "governance:default:credential-a",
    });
    const model = await create("/v1/models", {
      providerId: provider.id,
      modelId: "model-a",
      name: "Model A",
      kind: "chat",
    });
    const policy = await create("/v1/routing-policies", {
      name: "Primary",
      mode: "fixed",
      deploymentIds: [model.id],
      fixedDeploymentId: model.id,
    });

    const updatedProvider = await request(
      "PUT",
      `/v1/providers/${provider.id}`,
      {
        name: "edited",
        protocol: "openai",
        baseUrl: "https://models.example/v1",
        enabled: false,
      },
    );
    expect(updatedProvider.statusCode).toBe(200);
    expect(updatedProvider.json().data).toMatchObject({
      name: "edited",
      enabled: false,
      credentialRef: "governance:default:credential-a",
    });
    expect(
      (await request("GET", `/v1/providers/${provider.id}`)).json().data.name,
    ).toBe("edited");
    expect(
      (await request("DELETE", `/v1/providers/${provider.id}`)).statusCode,
    ).toBe(409);

    const updatedModel = await request("PUT", `/v1/models/${model.id}`, {
      providerId: provider.id,
      modelId: "model-b",
      name: "Model B",
      kind: "chat",
      enabled: false,
    });
    expect(updatedModel.statusCode).toBe(200);
    expect(
      (await request("GET", `/v1/models/${model.id}`)).json().data,
    ).toMatchObject({ modelId: "model-b", name: "Model B", enabled: false });
    expect(
      (await request("DELETE", `/v1/models/${model.id}`)).statusCode,
    ).toBe(409);

    const updatedPolicy = await request(
      "PUT",
      `/v1/routing-policies/${policy.id}`,
      {
        name: "Fallback",
        mode: "round-robin",
        deploymentIds: [model.id],
        failoverOnFailure: false,
      },
    );
    expect(updatedPolicy.statusCode).toBe(200);
    expect(
      (await request("GET", `/v1/routing-policies/${policy.id}`)).json().data,
    ).toMatchObject({
      name: "Fallback",
      mode: "round-robin",
      failoverOnFailure: false,
    });
    expect(
      (await request("DELETE", `/v1/routing-policies/${policy.id}`)).json()
        .data.removed,
    ).toBe(true);
    expect(
      (await request("DELETE", `/v1/models/${model.id}`)).json().data.removed,
    ).toBe(true);
    expect(
      (await request("DELETE", `/v1/providers/${provider.id}`)).json().data
        .removed,
    ).toBe(true);
    expect(
      (await request("GET", `/v1/providers/${provider.id}`)).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("normalizes OpenAI tool calls and preserves tool history", async () => {
    const requests: any[] = [];
    const repo = new MemoryModelRepository();
    const fetcher: typeof fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "browser_tool",
                      arguments: '{"url":"https://example.com"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const app = buildApp({ repository: repo, internalToken: token, fetcher });
    const create = async (url: string, payload: Record<string, unknown>) =>
      (await app.inject({ method: "POST", url, headers: auth, payload })).json()
        .data;
    const provider = await create("/v1/providers", {
      name: "tools",
      protocol: "openai",
      baseUrl: "https://tools.example",
    });
    const model = await create("/v1/models", {
      providerId: provider.id,
      modelId: "tool-model",
      name: "Tool Model",
      kind: "chat",
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/invoke",
      headers: auth,
      payload: {
        deploymentId: model.id,
        kind: "chat",
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "old", name: "x", input: { a: 1 } }],
          },
          { role: "tool", content: "done", toolCallId: "old", name: "x" },
        ],
        tools: [
          {
            type: "function",
            function: { name: "browser_tool", parameters: { type: "object" } },
          },
        ],
        correlationId: "tool-correlation",
      },
    });
    expect(response.json().data.output.toolCalls[0]).toEqual({
      id: "call-1",
      name: "browser_tool",
      input: { url: "https://example.com" },
    });
    expect(requests[0].messages[0].tool_calls[0].id).toBe("old");
    expect(requests[0].messages[1].tool_call_id).toBe("old");
    await app.close();
  });
});
