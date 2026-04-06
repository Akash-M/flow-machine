export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed with HTTP ${response.status}.`;
  const text = await response.text();

  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };

    if (isRecord(parsed) && typeof parsed.error === 'string') {
      return parsed.error;
    }

    if (isRecord(parsed) && typeof parsed.message === 'string') {
      return parsed.message;
    }
  } catch {
    return text;
  }

  return text || fallback;
}

export async function fetchJson<T>(input: string): Promise<T> {
  const response = await fetch(input);

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json() as Promise<T>;
}

export async function requestJson<T>(input: string, init: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function requestNdjsonStream<T>(input: string, init: RequestInit, onEvent: (event: T) => void): Promise<void> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (!response.body) {
    throw new Error('Response body was not readable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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

      onEvent(JSON.parse(trimmed) as T);
    }
  }

  const trailing = `${buffer}${decoder.decode()}`.trim();

  if (trailing) {
    onEvent(JSON.parse(trailing) as T);
  }
}

export async function requestText(input: string): Promise<string> {
  const response = await fetch(input);

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.text();
}

export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}