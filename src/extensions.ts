export type ExtensionState =
  | "installed"
  | "verified"
  | "canary"
  | "active"
  | "draining"
  | "disabled"
  | "failed"
  | "retired";
export interface ExtensionDescriptor {
  providerId: string;
  family: string;
  version: string;
  contractVersion: string;
  displayName: string;
  isolation: "in-process" | "worker" | "process" | "container" | "remote";
  capabilities: Record<string, boolean | string | number>;
}
export interface ExtensionRecord {
  descriptor: ExtensionDescriptor;
  lifecycleState: ExtensionState;
  lastProbe?: {
    status: "ready" | "unavailable";
    checkedAt: string;
    reason?: string;
  };
}
const transitions: Record<ExtensionState, ExtensionState[]> = {
  installed: ["verified", "disabled", "retired"],
  verified: ["canary", "active", "disabled", "retired"],
  canary: ["active", "draining", "disabled", "failed"],
  active: ["draining", "disabled", "failed"],
  draining: ["active", "disabled", "retired"],
  disabled: ["verified", "active", "retired"],
  failed: ["verified", "disabled", "retired"],
  retired: [],
};
export class ExtensionCatalog {
  private records = new Map<string, ExtensionRecord>();
  private events: Array<{
    id: string;
    providerId: string;
    action: string;
    message: string;
    createdAt: string;
  }> = [];
  constructor(descriptors: ExtensionDescriptor[]) {
    for (const descriptor of descriptors)
      this.records.set(descriptor.providerId, {
        descriptor,
        lifecycleState: "active",
      });
  }
  list() {
    return [...this.records.values()];
  }
  get(id: string) {
    const record = this.records.get(id);
    if (!record)
      throw Object.assign(new Error(`Extension not found: ${id}`), {
        statusCode: 404,
      });
    return record;
  }
  require(id: string) {
    const record = this.get(id);
    if (!["active", "canary"].includes(record.lifecycleState))
      throw Object.assign(
        new Error(`Extension ${id} is ${record.lifecycleState}`),
        { statusCode: 409 },
      );
    return record;
  }
  probe(id: string) {
    const record = this.get(id);
    record.lastProbe = {
      status: ["active", "canary", "verified"].includes(record.lifecycleState)
        ? "ready"
        : "unavailable",
      checkedAt: new Date().toISOString(),
      reason: record.lifecycleState,
    };
    this.log(id, "probe", record.lastProbe.status);
    return record.lastProbe;
  }
  transition(id: string, state: ExtensionState) {
    const record = this.get(id);
    if (
      record.lifecycleState !== state &&
      !transitions[record.lifecycleState].includes(state)
    )
      throw Object.assign(
        new Error(
          `Cannot move extension from ${record.lifecycleState} to ${state}`,
        ),
        { statusCode: 409 },
      );
    record.lifecycleState = state;
    this.log(id, "lifecycle", `Extension moved to ${state}`);
    return record;
  }
  logs(id?: string) {
    return this.events
      .filter((event) => !id || event.providerId === id)
      .slice(-200)
      .reverse();
  }
  private log(providerId: string, action: string, message: string) {
    this.events.push({
      id: crypto.randomUUID(),
      providerId,
      action,
      message,
      createdAt: new Date().toISOString(),
    });
  }
}
const descriptor = (
  protocol: string,
  displayName: string,
  capabilities: Record<string, boolean | string | number>,
): ExtensionDescriptor => ({
  providerId: `model-adapter.${protocol}`,
  family: "model-adapter",
  version: "1.0.0",
  contractVersion: "1.0",
  displayName,
  isolation: "in-process",
  capabilities,
});
export const modelExtensions = new ExtensionCatalog([
  descriptor("openai", "OpenAI Compatible Adapter", {
    chat: true,
    tools: true,
    embedding: true,
    image: true,
    speech: true,
  }),
  descriptor("anthropic", "Anthropic Adapter", { chat: true, tools: true }),
  descriptor("ollama", "Ollama Adapter", {
    chat: true,
    local: true,
    tools: true,
  }),
  descriptor("stable-diffusion", "Stable Diffusion Adapter", {
    imageGeneration: true,
    local: true,
  }),
  descriptor("custom-http", "Custom HTTP Adapter", { custom: true }),
]);
