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
2. Copy `.env.example` to `.env` and adjust values if needed.
3. Import secrets into the app when it first starts.
4. Run one startup command.

Target: less than 10 minutes for a developer who already has Podman and Ollama installed.

## Quick Start

```bash
cp .env.example .env
corepack yarn local:up
```

The `up` script builds the image and starts the local container directly with Podman. It does not require a separate compose provider.

If port `3000` is already taken on your machine, set `FLOW_MACHINE_PORT` in `.env` to a different value before starting.

## Live Reload Development

Use the host-side dev launcher when you want source changes to reload without rebuilding the Podman image.

```bash
cp .env.example .env
corepack yarn local:dev
```

This starts:

- package watchers for shared workspace builds,
- the API in watch mode on `http://127.0.0.1:3000`,
- the Vite dev server with HMR on `http://127.0.0.1:5173`.

Open the app on `http://127.0.0.1:5173` for live reload. The API keeps running on `3000` for the Vite proxy.

Use `Ctrl+C` to stop the live-reload stack. Keep `corepack yarn local:up` for the Podman-based production-like path.

## Monorepo Tooling

- Yarn 4.13.0 is pinned in the repository.
- `.yarnrc.yml` uses `injectEnvironmentFiles` so local Yarn commands automatically load `.env` and `.env.local` when present.
- The default one-command startup flow is `corepack yarn local:up`, which wraps the repo-owned Podman launcher.
- `corepack yarn local:dev` is the live-reload development path for UI and API work.

## License

Apache-2.0.

## Planning Docs

- [docs/project-plan.md](docs/project-plan.md)

## Status

Planning and architecture definition.
