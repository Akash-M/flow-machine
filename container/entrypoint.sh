#!/bin/sh
set -eu

DATA_DIR="${FLOW_MACHINE_DATA_DIR:-/data}"
MCP_CONFIG_PATH="${FLOW_MACHINE_MCP_CONFIG_PATH:-/data/mcp.json}"

mkdir -p "$DATA_DIR"
mkdir -p "$(dirname "$MCP_CONFIG_PATH")"
mkdir -p /workspace/host

if [ ! -f "$MCP_CONFIG_PATH" ]; then
  printf '{\n  "servers": {}\n}\n' > "$MCP_CONFIG_PATH"
fi

echo "Starting Flow Machine"
echo "  Repo mount: ${FLOW_MACHINE_REPO_ROOT:-/workspace/host}"
echo "  Data dir: $DATA_DIR"
echo "  Ollama: ${OLLAMA_BASE_URL:-http://host.containers.internal:11434}"
echo "  Privacy mode: ${FLOW_MACHINE_PRIVACY_MODE:-local-first}"

exec node /app/apps/api/dist/index.js
