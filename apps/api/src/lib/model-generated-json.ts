function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();

  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/u, '')
    .replace(/\s*```$/u, '')
    .trim();
}

function uniqueCandidates(candidates: string[]): string[] {
  return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
}

export function parseModelGeneratedJson(text: string): unknown {
  const normalized = stripMarkdownCodeFence(text);
  const candidates = [normalized];
  const firstObjectIndex = normalized.indexOf('{');
  const lastObjectIndex = normalized.lastIndexOf('}');
  const firstArrayIndex = normalized.indexOf('[');
  const lastArrayIndex = normalized.lastIndexOf(']');

  if (firstObjectIndex >= 0 && lastObjectIndex > firstObjectIndex) {
    candidates.push(normalized.slice(firstObjectIndex, lastObjectIndex + 1));
  }

  if (firstArrayIndex >= 0 && lastArrayIndex > firstArrayIndex) {
    candidates.push(normalized.slice(firstArrayIndex, lastArrayIndex + 1));
  }

  let lastError: Error | null = null;

  for (const candidate of uniqueCandidates(candidates)) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Model returned invalid JSON.');
    }
  }

  throw new Error(
    lastError?.message
      ? `Model returned invalid JSON: ${lastError.message}`
      : 'Model returned invalid JSON. Refine the prompt and try again.'
  );
}