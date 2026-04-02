# flow-machine

Local-first workflow automation for developers.

The goal is to build a product in the same problem space as n8n, but optimized for local developer workflows, explicit privacy controls, MCP-first integrations, and low-cost model usage through Ollama.

## Current Direction

- Host-native Ollama is the default model runtime for v1.
- The application itself runs locally in Podman.
- Repositories are mounted from the host into the container for v1.
- Workflows are stored in Git-friendly JSON and are exportable.
- MCP support is a core part of the architecture.
- Strict local-only mode blocks all outbound network access except localhost.
- The onboarding target is one documented startup command after secrets and environment configuration.

## Product Principles

- Local-first execution with explicit privacy status.
- Fast onboarding with minimal host setup.
- Clear approvals for risky actions.
- Strong developer visibility into logs, prompts, tool usage, and network activity.
- Extensible task system for future custom workflows and shareable integrations.

## Planned Onboarding

1. Clone the repository.
2. Configure environment variables and import secrets.
3. Run one startup command.

Target: less than 10 minutes for a developer who already has Podman and Ollama installed.

## Planning Docs

- [docs/project-plan.md](docs/project-plan.md)

## Status

Planning and architecture definition.
