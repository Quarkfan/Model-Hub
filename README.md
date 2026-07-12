# Model Hub

This repository is the standalone home for Model Hub（MH，模型枢纽）design and future implementation.

Model Hub is not only an LLM provider manager. It is the platform center for model service registration, capability description, routing, fallback, health, credentials, usage, cost, and deployment visibility across text, image, audio, embedding, rerank, vision, local models, and self-hosted inference.

## Scope

- Model providers, credentials, deployments, aliases and profiles
- Model capabilities across chat, agent, embedding, rerank, moderation, vision, speech-to-text, TTS, image generation, image editing and multimodal tasks
- Routing policies such as fixed, round-robin, random, least-busy, cost-aware and latency-aware
- Fallback, retry, cooldown, health checks and model availability
- Usage, token, latency, cost and invocation trace records
- Local model providers such as Ollama and desktop OpenAI-compatible endpoints
- Self-hosted deployments such as vLLM or other OpenAI-compatible serving stacks
- Capability exports that Tool & Capability Center can wrap into tools

Authoritative Model Hub notes live here:

- `STATUS.md`: current phase, source of truth, and next work.
- `docs/model-hub.md`: domain design and responsibility boundaries.
- `docs/implementation-blueprint.md`: executable implementation blueprint for DTOs, storage, APIs, workflows, tests and migration.

Platform-wide center boundaries, cross-center protocols, reference matrix and deployment blueprints live in the parent QuarkfanTools repository.

## New Session Checklist

1. Read `AGENTS.md` and `STATUS.md`.
2. Read `docs/model-hub.md` for the domain model and boundaries.
3. Read `docs/implementation-blueprint.md` for buildable P0 contracts, storage, APIs, tests and migration phases.
4. If the task touches cross-center protocols or platform ownership, also read the parent repository docs: `docs/platform-centers.md` and `docs/platform-interface-protocols.md`.
5. If implementation moves into the standalone app first, update both this repository and the parent submodule pointer after committing here.
