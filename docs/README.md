# Model Hub Docs

This directory contains Model Hub-specific documentation.

- `model-hub.md`: core Model Hub domain design for model providers, deployments, capabilities, routing, fallback, health, credentials, usage, and cross-center boundaries.
- `boundary-and-exposure-reference.md`: source-backed boundary and exposure rules for what MH can expose to runtime, CH, tools, UI, diagnostics, and what must remain internal.
- `implementation-blueprint.md`: executable contracts, data models, storage layout, APIs, migration phases, tests, and acceptance checks for implementation.

Platform-wide center boundaries, cross-center protocols, reference matrix, and deployment blueprints live in the parent QuarkfanTools repository.

For a new MH session, read `../AGENTS.md`, `../STATUS.md`, `model-hub.md`, `boundary-and-exposure-reference.md`, and `implementation-blueprint.md` in that order.
