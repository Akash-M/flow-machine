import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { SecretSummary } from '@flow-machine/shared-types';

import { AppConfig } from './config';
import { stableStringify } from './stable-json';

interface SecretEntry {
  value: string;
  updatedAt: string;
}

interface SecretState {
  version: '1';
  entries: Record<string, SecretEntry>;
}

interface EncryptedSecretState {
  version: '1';
  iv: string;
  tag: string;
  ciphertext: string;
}

const secretKeyPattern = /^[A-Za-z0-9_.-]+$/;

function createEmptySecretState(): SecretState {
  return {
    version: '1',
    entries: {}
  };
}

function normalizeSecretKey(key: string): string {
  const nextKey = key.trim();

  if (!secretKeyPattern.test(nextKey)) {
    throw new Error('Secret keys may only contain letters, numbers, dot, underscore, and dash.');
  }

  return nextKey;
}

function sanitizeSecretValue(value: string): string {
  if (!value.length) {
    throw new Error('Secret value is required.');
  }

  return value;
}

function deriveEncryptionKey(masterKey: string): Buffer {
  return createHash('sha256').update(masterKey).digest();
}

function parseEnvValue(rawValue: string): string {
  const value = rawValue.trim();

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\n/g, '\n');
  }

  return value;
}

export class SecretStore {
  private readonly dataPath: string;

  private readonly masterKeyPath: string;

  constructor(private readonly config: AppConfig) {
    this.dataPath = path.join(config.dataDir, 'secrets.enc.json');
    this.masterKeyPath = path.join(config.dataDir, 'secrets.master');
    fs.mkdirSync(config.dataDir, { recursive: true });
  }

  listSecrets(): SecretSummary[] {
    return Object.entries(this.readState().entries)
      .sort((left, right) => right[1].updatedAt.localeCompare(left[1].updatedAt))
      .map(([key, entry]) => ({
        key,
        updatedAt: entry.updatedAt,
        backend: 'encrypted-file'
      }));
  }

  getSecretValue(key: string): string | null {
    return this.readState().entries[normalizeSecretKey(key)]?.value ?? null;
  }

  upsertSecret(key: string, value: string): SecretSummary {
    const normalizedKey = normalizeSecretKey(key);
    const nextValue = sanitizeSecretValue(value);
    const state = this.readState();
    const updatedAt = new Date().toISOString();

    state.entries[normalizedKey] = {
      value: nextValue,
      updatedAt
    };

    this.writeState(state);

    return {
      key: normalizedKey,
      updatedAt,
      backend: 'encrypted-file'
    };
  }

  deleteSecret(key: string): boolean {
    const normalizedKey = normalizeSecretKey(key);
    const state = this.readState();

    if (!state.entries[normalizedKey]) {
      return false;
    }

    delete state.entries[normalizedKey];
    this.writeState(state);
    return true;
  }

  importEnvFile(content: string): SecretSummary[] {
    const state = this.readState();
    const updated: SecretSummary[] = [];

    for (const rawLine of content.split(/\r?\n/)) {
      const trimmedLine = rawLine.trim();

      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }

      const normalizedLine = trimmedLine.startsWith('export ') ? trimmedLine.slice('export '.length).trim() : trimmedLine;
      const separatorIndex = normalizedLine.indexOf('=');

      if (separatorIndex <= 0) {
        continue;
      }

      const key = normalizeSecretKey(normalizedLine.slice(0, separatorIndex).trim());
      const value = parseEnvValue(normalizedLine.slice(separatorIndex + 1));
      const updatedAt = new Date().toISOString();

      state.entries[key] = {
        value,
        updatedAt
      };

      updated.push({
        key,
        updatedAt,
        backend: 'encrypted-file'
      });
    }

    if (updated.length > 0) {
      this.writeState(state);
    }

    return updated;
  }

  private ensureMasterKey(): string {
    if (fs.existsSync(this.masterKeyPath)) {
      return fs.readFileSync(this.masterKeyPath, 'utf8').trim();
    }

    const masterKey = randomBytes(32).toString('hex');
    fs.writeFileSync(this.masterKeyPath, `${masterKey}\n`, { encoding: 'utf8', mode: 0o600 });
    return masterKey;
  }

  private readState(): SecretState {
    if (!fs.existsSync(this.dataPath)) {
      return createEmptySecretState();
    }

    const encrypted = JSON.parse(fs.readFileSync(this.dataPath, 'utf8')) as EncryptedSecretState;

    if (!encrypted || encrypted.version !== '1') {
      throw new Error('Secrets storage is invalid or uses an unsupported format.');
    }

    const key = deriveEncryptionKey(this.ensureMasterKey());
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));

    const content = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'hex')),
      decipher.final()
    ]).toString('utf8');

    const parsed = JSON.parse(content) as SecretState;

    if (!parsed || parsed.version !== '1' || typeof parsed.entries !== 'object' || parsed.entries === null) {
      throw new Error('Secrets storage contents are invalid.');
    }

    return parsed;
  }

  private writeState(state: SecretState): void {
    const key = deriveEncryptionKey(this.ensureMasterKey());
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(stableStringify(state), 'utf8'),
      cipher.final()
    ]);

    const encryptedState: EncryptedSecretState = {
      version: '1',
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      ciphertext: ciphertext.toString('hex')
    };

    fs.writeFileSync(this.dataPath, stableStringify(encryptedState), 'utf8');
  }
}