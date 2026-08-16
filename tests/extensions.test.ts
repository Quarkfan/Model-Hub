import { describe, expect, it } from "vitest";
import {
  ExtensionCatalog,
  MemoryExtensionStateRepository,
  type ExtensionDescriptor,
} from "../src/extensions.js";

const descriptor: ExtensionDescriptor = {
  providerId: "model-adapter.test",
  family: "model-adapter",
  version: "1.0.0",
  contractVersion: "1.0",
  displayName: "Test Model Adapter",
  isolation: "remote",
  capabilities: { chat: true },
};

describe("model extension lifecycle", () => {
  it("persists probes, lifecycle gates and logs across catalog restarts", async () => {
    const repository = new MemoryExtensionStateRepository();
    const catalog = new ExtensionCatalog([descriptor], repository);
    await catalog.initialize();

    expect((await catalog.probe("model-adapter.test")).status).toBe("ready");
    await catalog.transition("model-adapter.test", "disabled");
    expect(() => catalog.require("model-adapter.test")).toThrow("disabled");
    await expect(
      catalog.transition("model-adapter.test", "canary"),
    ).rejects.toThrow("Cannot move");

    const restored = new ExtensionCatalog([descriptor], repository);
    await restored.initialize();
    expect(restored.get("model-adapter.test").lifecycleState).toBe("disabled");
    expect(await restored.logs("model-adapter.test")).toHaveLength(3);

    expect((await restored.probe("model-adapter.test")).status).toBe("ready");
    await restored.transition("model-adapter.test", "verified");
    expect(restored.get("model-adapter.test").lifecycleState).toBe("verified");
    expect(await restored.logs("model-adapter.test")).toHaveLength(6);
  });
});
