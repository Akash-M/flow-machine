import fs from 'node:fs';
import path from 'node:path';

import { LocalRepository } from '@flow-machine/shared-types';

import { AppConfig } from './config';

export const mountedRootRepositoryId = 'mounted-root';

function normalizeRelativePath(value: string): string {
  const normalized = value.split(path.sep).join('/');
  return normalized.length > 0 ? normalized : '.';
}

function isInsideRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

export function ensurePathInsideRoot(rootPath: string, requestedPath: string): string {
  const resolvedPath = path.resolve(rootPath, requestedPath);

  if (!isInsideRoot(rootPath, resolvedPath)) {
    throw new Error(`Path ${requestedPath} is outside the mounted repository.`);
  }

  return resolvedPath;
}

export function resolveRepositoryRuntimeRoot(config: AppConfig, repository: Pick<LocalRepository, 'relativePath'> | null): string {
  return ensurePathInsideRoot(config.repoRoot, repository?.relativePath ?? '.');
}

export function createRepositoryReference(
  config: AppConfig,
  options: {
    hostPath: string;
    id: string;
    name?: string;
    source: LocalRepository['source'];
    updatedAt?: string;
  }
): LocalRepository {
  const mountedHostRoot = path.resolve(config.repoMountSource);
  const resolvedHostPath = path.resolve(options.hostPath);
  const validatedHostPath = ensurePathInsideRoot(mountedHostRoot, resolvedHostPath);

  if (!fs.existsSync(validatedHostPath) || !fs.statSync(validatedHostPath).isDirectory()) {
    throw new Error(`Repository path ${validatedHostPath} is not an accessible directory inside the mounted root.`);
  }

  return {
    id: options.id,
    name: options.name?.trim() || path.basename(validatedHostPath) || 'Repository',
    hostPath: validatedHostPath,
    relativePath: normalizeRelativePath(path.relative(mountedHostRoot, validatedHostPath)),
    isGitRepository: fs.existsSync(path.join(validatedHostPath, '.git')),
    source: options.source,
    updatedAt: options.updatedAt ?? new Date().toISOString()
  };
}

export function createMountedRootRepository(config: AppConfig): LocalRepository {
  const mountedHostRoot = path.resolve(config.repoMountSource);

  return createRepositoryReference(config, {
    hostPath: mountedHostRoot,
    id: mountedRootRepositoryId,
    name: path.basename(mountedHostRoot) || 'Mounted root',
    source: 'mounted-root',
    updatedAt: config.startedAt
  });
}

export function createAdHocRepository(config: AppConfig, inputPath: string): LocalRepository {
  const mountedHostRoot = path.resolve(config.repoMountSource);
  const hostPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(mountedHostRoot, inputPath);
  const resolvedHostPath = ensurePathInsideRoot(mountedHostRoot, hostPath);
  const relativePath = normalizeRelativePath(path.relative(mountedHostRoot, resolvedHostPath));

  return createRepositoryReference(config, {
    hostPath: resolvedHostPath,
    id: `adhoc:${relativePath}`,
    source: 'ad-hoc'
  });
}