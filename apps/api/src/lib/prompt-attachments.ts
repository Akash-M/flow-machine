import path from 'node:path';

import { PDFParse } from 'pdf-parse';

import { PromptAttachmentPayload } from '@flow-machine/shared-types';

const maxAttachmentCharacters = 12_000;
const supportedTextMimeTypes = new Set([
  'application/json',
  'application/ld+json',
  'application/sql',
  'application/xml',
  'application/x-sh',
  'application/x-yaml'
]);
const supportedTextExtensions = new Set([
  '.c',
  '.cfg',
  '.conf',
  '.cpp',
  '.css',
  '.csv',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.markdown',
  '.mjs',
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
  '.xml',
  '.yaml',
  '.yml'
]);

function normalizeMimeType(type: string): string {
  return type.trim().toLowerCase();
}

function inferExtension(name: string): string {
  return path.extname(name).trim().toLowerCase();
}

function decodeAttachment(attachment: PromptAttachmentPayload): Buffer {
  return Buffer.from(attachment.contentBase64, 'base64');
}

function truncateText(text: string): { text: string; truncated: boolean } {
  if (text.length <= maxAttachmentCharacters) {
    return {
      text,
      truncated: false
    };
  }

  return {
    text: text.slice(0, maxAttachmentCharacters),
    truncated: true
  };
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const scaled = size / 1024 ** exponent;

  return `${scaled >= 10 || exponent === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[exponent]}`;
}

function isImageAttachment(attachment: PromptAttachmentPayload): boolean {
  return normalizeMimeType(attachment.type).startsWith('image/');
}

function isPdfAttachment(attachment: PromptAttachmentPayload): boolean {
  return normalizeMimeType(attachment.type) === 'application/pdf' || inferExtension(attachment.name) === '.pdf';
}

function isTextAttachment(attachment: PromptAttachmentPayload): boolean {
  const normalizedType = normalizeMimeType(attachment.type);

  return normalizedType.startsWith('text/') || supportedTextMimeTypes.has(normalizedType) || supportedTextExtensions.has(inferExtension(attachment.name));
}

async function extractAttachmentText(attachment: PromptAttachmentPayload): Promise<{ text: string; truncated: boolean } | null> {
  const buffer = decodeAttachment(attachment);

  if (isPdfAttachment(attachment)) {
    const parser = new PDFParse({ data: buffer });

    try {
      const parsed = await parser.getText();
      const normalized = parsed.text.replace(/\u0000/g, '').trim();

      if (!normalized) {
        return null;
      }

      return truncateText(normalized);
    } finally {
      await parser.destroy();
    }
  }

  if (!isTextAttachment(attachment)) {
    return null;
  }

  const normalized = buffer.toString('utf8').replace(/\u0000/g, '').trim();

  if (!normalized) {
    return null;
  }

  return truncateText(normalized);
}

export interface PromptAttachmentContext {
  images: string[];
  promptContext: string;
}

export async function buildPromptAttachmentContext(
  attachments: PromptAttachmentPayload[] | undefined,
  onStatus?: (message: string) => void
): Promise<PromptAttachmentContext> {
  if (!attachments || attachments.length === 0) {
    return {
      images: [],
      promptContext: ''
    };
  }

  const sections: string[] = [];
  const images: string[] = [];

  for (const attachment of attachments) {
    onStatus?.(`Preparing attachment context for ${attachment.name}…`);
    const metadata = `${attachment.name} (${attachment.type || 'unknown type'}, ${formatBytes(attachment.size)})`;

    if (isImageAttachment(attachment)) {
      images.push(attachment.contentBase64);
      sections.push(`Attachment: ${metadata}\nThis image was sent to the model as visual context.`);
      continue;
    }

    try {
      const extracted = await extractAttachmentText(attachment);

      if (!extracted) {
        sections.push(`Attachment: ${metadata}\nNo readable text could be extracted. Use the file metadata as supporting context only.`);
        continue;
      }

      sections.push(
        `Attachment: ${metadata}\n${extracted.text}${extracted.truncated ? '\n[Attachment text truncated for prompt size.]' : ''}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown attachment parsing error.';
      sections.push(`Attachment: ${metadata}\nThe file could not be parsed automatically: ${message}`);
    }
  }

  return {
    images,
    promptContext: sections.length > 0 ? `Additional user-provided context:\n\n${sections.join('\n\n')}` : ''
  };
}