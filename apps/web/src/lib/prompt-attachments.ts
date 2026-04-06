import { PromptAttachmentPayload } from '@flow-machine/shared-types';

const maxAttachmentSizeBytes = 5 * 1024 * 1024;
let promptAttachmentSequence = 0;

export interface PromptAttachmentDraft extends PromptAttachmentPayload {
  id: string;
}

export interface PromptAttachmentReadResult {
  attachments: PromptAttachmentDraft[];
  errors: string[];
}

type PromptAttachmentLike = Pick<PromptAttachmentPayload, 'name' | 'size' | 'type'>;

export const promptAttachmentInputAccept = [
  '.c',
  '.conf',
  '.cpp',
  '.css',
  '.csv',
  '.gif',
  '.go',
  '.html',
  '.java',
  '.jpeg',
  '.jpg',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.markdown',
  '.md',
  '.pdf',
  '.png',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.webp',
  '.xml',
  '.yaml',
  '.yml',
  'application/pdf',
  'image/*',
  'text/*'
].join(',');

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const scaled = size / 1024 ** exponent;

  return `${scaled >= 10 || exponent === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[exponent]}`;
}

function promptAttachmentKey(attachment: PromptAttachmentLike): string {
  return `${attachment.name}:${attachment.size}:${attachment.type}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Could not read ${file.name}.`));
        return;
      }

      resolve(reader.result);
    };

    reader.readAsDataURL(file);
  });
}

async function toPromptAttachmentDraft(file: File): Promise<PromptAttachmentDraft> {
  const dataUrl = await readFileAsDataUrl(file);
  const [, contentBase64 = ''] = dataUrl.split(',', 2);

  promptAttachmentSequence += 1;

  return {
    id: `prompt-attachment-${promptAttachmentSequence}`,
    contentBase64,
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream'
  };
}

export async function readPromptAttachments(files: FileList | File[]): Promise<PromptAttachmentReadResult> {
  const fileEntries = Array.from(files);
  const attachments: PromptAttachmentDraft[] = [];
  const errors: string[] = [];

  for (const file of fileEntries) {
    if (file.size > maxAttachmentSizeBytes) {
      errors.push(`${file.name} is larger than the ${formatBytes(maxAttachmentSizeBytes)} upload limit.`);
      continue;
    }

    try {
      attachments.push(await toPromptAttachmentDraft(file));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Could not read ${file.name}.`);
    }
  }

  return {
    attachments,
    errors
  };
}

export function toPromptAttachmentPayloads(attachments: PromptAttachmentDraft[]): PromptAttachmentPayload[] {
  return attachments.map(({ contentBase64, name, size, type }) => ({
    contentBase64,
    name,
    size,
    type
  }));
}

export function formatPromptAttachmentSize(size: number): string {
  return formatBytes(size);
}

export function mergePromptAttachmentDrafts(
  existingAttachments: PromptAttachmentDraft[],
  nextAttachments: PromptAttachmentDraft[]
): PromptAttachmentDraft[] {
  const seenKeys = new Set(existingAttachments.map((attachment) => promptAttachmentKey(attachment)));
  const dedupedNewAttachments = nextAttachments.filter((attachment) => {
    const key = promptAttachmentKey(attachment);

    if (seenKeys.has(key)) {
      return false;
    }

    seenKeys.add(key);
    return true;
  });

  return [...existingAttachments, ...dedupedNewAttachments];
}

export function isPromptAttachmentImageType(type: string): boolean {
  return type.toLowerCase().startsWith('image/');
}

export function hasImagePromptAttachments(attachments: Array<Pick<PromptAttachmentPayload, 'type'>>): boolean {
  return attachments.some((attachment) => isPromptAttachmentImageType(attachment.type));
}