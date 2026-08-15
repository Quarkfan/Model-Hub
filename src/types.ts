export type ProviderProtocol =
  "openai" | "anthropic" | "ollama" | "stable-diffusion" | "custom-http";
export type ModelKind =
  | "chat"
  | "completion"
  | "embedding"
  | "rerank"
  | "vision"
  | "image-generation"
  | "image-edit"
  | "speech-to-text"
  | "text-to-speech"
  | "video-generation";
export interface ModelProvider {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  credentialRef?: string;
  enabled: boolean;
  priority: number;
  weight: number;
  headers: Record<string, string>;
  status: "configured" | "healthy" | "degraded" | "disabled" | "error";
  lastProbeAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
export interface ModelDeployment {
  id: string;
  providerId: string;
  modelId: string;
  name: string;
  kind: ModelKind;
  enabled: boolean;
  capabilities: string[];
  contextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface RoutingPolicy {
  id: string;
  name: string;
  kind?: ModelKind;
  mode: "fixed" | "round-robin" | "random";
  deploymentIds: string[];
  fixedDeploymentId?: string;
  failoverOnFailure: boolean;
  maxAttempts: number;
  enabled: boolean;
  cursor: number;
  createdAt: string;
  updatedAt: string;
}
export interface AttemptPlan {
  policyId: string;
  attempts: Array<{
    index: number;
    deploymentId: string;
    providerId: string;
    modelId: string;
    kind: ModelKind;
  }>;
}
export interface ModelToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
}
export interface ModelInvokeRequest {
  policyId?: string;
  deploymentId?: string;
  kind: ModelKind;
  messages?: ChatMessage[];
  prompt?: string;
  input?: unknown;
  temperature?: number;
  maxTokens?: number;
  tools?: Array<Record<string, unknown>>;
  responseFormat?: Record<string, unknown>;
  correlationId: string;
}
export interface ModelInvokeResult {
  invocationId: string;
  deploymentId: string;
  providerId: string;
  modelId: string;
  kind: ModelKind;
  output: unknown;
  finishReason?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
  };
  attempts: Array<{
    deploymentId: string;
    status: "success" | "failed";
    durationMs: number;
    errorCode?: string;
  }>;
}
export interface UsageRecord {
  id: string;
  invocationId: string;
  providerId: string;
  deploymentId: string;
  modelId: string;
  kind: ModelKind;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  status: "success" | "failed";
  latencyMs: number;
  correlationId: string;
  createdAt: string;
}
