import {
  ExtensionCatalog,
  type ExtensionDescriptor,
  type ExtensionStateRepository,
} from "./extension-catalog.js";

export * from "./extension-catalog.js";

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

export const createModelExtensions = (repository?: ExtensionStateRepository) =>
  new ExtensionCatalog(
    [
      descriptor("openai", "OpenAI Compatible Adapter", {
        chat: true,
        tools: true,
        embedding: true,
        image: true,
        speech: true,
      }),
      descriptor("anthropic", "Anthropic Adapter", {
        chat: true,
        tools: true,
      }),
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
    ],
    repository,
  );
