import { OllamaModelDescriptor } from '@flow-machine/shared-types';

export interface OllamaPullStreamChunk {
  completed?: number;
  digest?: string;
  error?: string;
  message?: string;
  status?: string;
  total?: number;
}

async function readOllamaErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text();

  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };

    if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
      return parsed.error.trim();
    }

    if (typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
      return parsed.message.trim();
    }
  } catch {
    return text.trim();
  }

  return text.trim() || fallback;
}

export async function listOllamaModels(baseUrl: string): Promise<OllamaModelDescriptor[]> {
  const response = await fetch(new URL('/api/tags', baseUrl), {
    signal: AbortSignal.timeout(5_000)
  });

  if (!response.ok) {
    throw new Error(await readOllamaErrorMessage(response, `Could not list Ollama models: HTTP ${response.status}.`));
  }

  const body = (await response.json()) as {
    models?: Array<{ name?: string; size?: number; modified_at?: string; digest?: string }>;
  };

  return (body.models ?? [])
    .filter((entry): entry is NonNullable<typeof body.models>[number] & { name: string } => typeof entry.name === 'string' && entry.name.length > 0)
    .map((entry) => ({
      name: entry.name,
      size: typeof entry.size === 'number' ? entry.size : null,
      modifiedAt: typeof entry.modified_at === 'string' ? entry.modified_at : null,
      digest: typeof entry.digest === 'string' ? entry.digest : null
    }));
}

export async function getOllamaModelCapabilities(baseUrl: string, modelName: string): Promise<string[]> {
  const response = await fetch(new URL('/api/show', baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: modelName
    }),
    signal: AbortSignal.timeout(5_000)
  });

  if (!response.ok) {
    throw new Error(await readOllamaErrorMessage(response, `Could not inspect Ollama model ${modelName}: HTTP ${response.status}.`));
  }

  const body = (await response.json()) as { capabilities?: unknown };

  if (!Array.isArray(body.capabilities)) {
    return [];
  }

  return body.capabilities.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

export async function getOllamaVersion(baseUrl: string): Promise<string> {
  const response = await fetch(new URL('/api/version', baseUrl), {
    signal: AbortSignal.timeout(5_000)
  });

  if (!response.ok) {
    throw new Error(await readOllamaErrorMessage(response, `Could not get Ollama version: HTTP ${response.status}.`));
  }

  const body = (await response.json()) as { version?: string };

  if (typeof body.version !== 'string' || body.version.trim().length === 0) {
    throw new Error('Ollama did not return a version string.');
  }

  return body.version.trim();
}

export async function pullOllamaModel(baseUrl: string, name: string): Promise<void> {
  const response = await fetch(new URL('/api/pull', baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(await readOllamaErrorMessage(response, `Could not pull model ${name}: HTTP ${response.status}.`));
  }
}

export async function streamOllamaModelPull(
  baseUrl: string,
  name: string,
  onChunk: (chunk: OllamaPullStreamChunk) => void
): Promise<void> {
  const response = await fetch(new URL('/api/pull', baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name,
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(await readOllamaErrorMessage(response, `Could not pull model ${name}: HTTP ${response.status}.`));
  }

  if (!response.body) {
    throw new Error('Ollama did not return a readable pull stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line: string) => {
    const parsed = JSON.parse(line) as OllamaPullStreamChunk;

    if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
      throw new Error(parsed.error.trim());
    }

    onChunk(parsed);
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      handleLine(trimmed);
    }
  }

  const trailing = `${buffer}${decoder.decode()}`.trim();

  if (trailing) {
    handleLine(trailing);
  }
}