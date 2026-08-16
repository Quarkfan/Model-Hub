import { describe, expect, it } from "vitest";
import { ExtensionCatalog } from "../src/extensions.js";

describe("model extension lifecycle", () => {
  it("probes, gates execution and records transitions", () => {
    const catalog = new ExtensionCatalog([
      {
        providerId: "model-adapter.test",
        family: "model-adapter",
        version: "1.0.0",
        contractVersion: "1.0",
        displayName: "Test Model Adapter",
        isolation: "remote",
        capabilities: { chat: true },
      },
    ]);
    expect(catalog.probe("model-adapter.test").status).toBe("ready");
    catalog.transition("model-adapter.test", "disabled");
    expect(() => catalog.require("model-adapter.test")).toThrow("disabled");
    expect(() => catalog.transition("model-adapter.test", "canary")).toThrow(
      "Cannot move",
    );
    expect(catalog.logs("model-adapter.test")).toHaveLength(2);
  });
});
