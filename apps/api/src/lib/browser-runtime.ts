import fs from 'node:fs/promises';
import path from 'node:path';

import { BrowserRuntimeStatus, WorkflowNode, WorkflowRunNetworkActivity } from '@flow-machine/shared-types';

import { AppConfig } from './config';

type RuntimeLogger = (level: 'info' | 'warn' | 'error', message: string, data?: unknown) => void;

interface BrowserRuntimeContext {
  config: AppConfig;
  log: RuntimeLogger;
  node: WorkflowNode;
  signal: AbortSignal;
  timeoutMs: number;
}

interface BrowserAutomationResult {
  output: unknown;
  network: WorkflowRunNetworkActivity[];
}

type PlaywrightModule = typeof import('playwright');

let browserStatusCache: { expiresAt: number; value: BrowserRuntimeStatus } | null = null;
let browserStatusInFlight: Promise<BrowserRuntimeStatus> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function abortMessage(signal: AbortSignal): string {
  if (signal.reason instanceof Error && signal.reason.message) {
    return signal.reason.message;
  }

  if (typeof signal.reason === 'string' && signal.reason.trim().length > 0) {
    return signal.reason;
  }

  return 'Run stopped by user.';
}

function createAbortError(signal: AbortSignal): Error {
  const error = new Error(abortMessage(signal));
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createAbortError(signal);
  }
}

function truncateText(value: string, maxLength = 12_000): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n...[truncated]`;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function normalizeActionType(value: string): string {
  return value.trim().replace(/_/g, '-').replace(/\s+/g, '-').toLowerCase();
}

function loadPlaywright(): PlaywrightModule | null {
  try {
    return require('playwright') as PlaywrightModule;
  } catch {
    return null;
  }
}

function ensurePathInsideRoot(rootPath: string, requestedPath: string): string {
  const resolvedPath = path.resolve(rootPath, requestedPath);
  const relativePath = path.relative(rootPath, resolvedPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Path ${requestedPath} is outside the mounted repository.`);
  }

  return resolvedPath;
}

function shouldTrackNetwork(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function assertBrowserUrlAllowed(config: AppConfig, rawUrl: string): URL {
  const url = new URL(rawUrl);

  if (shouldTrackNetwork(url) && config.privacyMode === 'strict-local' && !isLoopbackHostname(url.hostname)) {
    throw new Error(`Strict local-only mode blocks browser access to ${url.origin}.`);
  }

  return url;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveStorageState(value: unknown, repoRoot: string): Promise<unknown | undefined> {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (isRecord(value) || Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    throw new Error('Browser automation storageState must be an object or JSON string.');
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return undefined;
  }

  if (trimmedValue.startsWith('{') || trimmedValue.startsWith('[')) {
    return JSON.parse(trimmedValue) as unknown;
  }

  const resolvedPath = ensurePathInsideRoot(repoRoot, trimmedValue);
  const content = await fs.readFile(resolvedPath, 'utf8');
  return JSON.parse(content) as unknown;
}

async function saveScreenshot(page: import('playwright').Page, repoRoot: string, actionConfig: Record<string, unknown>): Promise<string> {
  const screenshotPath = asString(actionConfig.path) ?? asString(actionConfig.saveTo);

  if (!screenshotPath) {
    throw new Error('Screenshot actions require path or saveTo.');
  }

  const resolvedPath = ensurePathInsideRoot(repoRoot, screenshotPath);
  const type = asString(actionConfig.type) === 'jpeg' ? 'jpeg' : 'png';
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await page.screenshot({
    fullPage: asBoolean(actionConfig.fullPage) ?? true,
    path: resolvedPath,
    quality: type === 'jpeg' ? asNumber(actionConfig.quality) ?? undefined : undefined,
    type
  });

  return screenshotPath;
}

async function extractValue(page: import('playwright').Page, actionConfig: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const selector = asString(actionConfig.selector);

  if (!selector) {
    throw new Error('Extract actions require selector.');
  }

  const attribute = asString(actionConfig.attribute);
  const mode = asString(actionConfig.mode) ?? (attribute ? 'attribute' : 'text');
  const all = asBoolean(actionConfig.all) ?? false;

  await page.waitForSelector(selector, {
    timeout: asNumber(actionConfig.timeoutMs) ?? timeoutMs
  });

  if (all) {
    return page.$$eval(
      selector,
      (elements, params) =>
        elements.map((element) => {
          if (params.attribute) {
            return element.getAttribute(params.attribute);
          }

          if (params.mode === 'html') {
            return element.innerHTML;
          }

          if (params.mode === 'outer-html') {
            return element.outerHTML;
          }

          return element.textContent?.trim() ?? '';
        }),
      {
        attribute,
        mode
      }
    );
  }

  return page.$eval(
    selector,
    (element, params) => {
      if (params.attribute) {
        return element.getAttribute(params.attribute);
      }

      if (params.mode === 'html') {
        return element.innerHTML;
      }

      if (params.mode === 'outer-html') {
        return element.outerHTML;
      }

      return element.textContent?.trim() ?? '';
    },
    {
      attribute,
      mode
    }
  );
}

async function computeBrowserRuntimeStatus(): Promise<BrowserRuntimeStatus> {
  const playwright = loadPlaywright();

  if (!playwright) {
    return {
      available: false,
      message: 'Playwright is not installed in this build yet.',
      provider: 'unconfigured'
    };
  }

  try {
    const executablePath = playwright.chromium.executablePath();

    if (!(await pathExists(executablePath))) {
      return {
        available: false,
        message: 'Playwright is installed, but Chromium is not available yet. Run yarn playwright install chromium or rebuild the local container image.',
        provider: 'playwright'
      };
    }

    return {
      available: true,
      message: 'Playwright Chromium is installed and ready for browser automation tasks.',
      provider: 'playwright'
    };
  } catch (error) {
    return {
      available: false,
      message: error instanceof Error ? error.message : 'Could not determine Playwright browser availability.',
      provider: 'playwright'
    };
  }
}

export async function getBrowserRuntimeStatus(): Promise<BrowserRuntimeStatus> {
  const now = Date.now();

  if (browserStatusCache && browserStatusCache.expiresAt > now) {
    return browserStatusCache.value;
  }

  if (browserStatusInFlight) {
    return browserStatusInFlight;
  }

  browserStatusInFlight = computeBrowserRuntimeStatus()
    .then((value) => {
      browserStatusCache = {
        expiresAt: Date.now() + 10_000,
        value
      };

      return value;
    })
    .finally(() => {
      browserStatusInFlight = null;
    });

  return browserStatusInFlight;
}

export async function executeBrowserAutomation(context: BrowserRuntimeContext): Promise<BrowserAutomationResult> {
  throwIfAborted(context.signal);
  const playwright = loadPlaywright();
  const browserStatus = await getBrowserRuntimeStatus();

  if (!playwright || !browserStatus.available) {
    throw new Error(browserStatus.message);
  }

  const initialUrl = asString(context.node.config.url) ?? asString(context.node.config.startUrl);
  const actions = Array.isArray(context.node.config.actions)
    ? context.node.config.actions.filter(isRecord)
    : [];

  if (!initialUrl && !actions.some((action) => normalizeActionType(asString(action.type) ?? '') === 'goto')) {
    throw new Error('Browser automation requires config.url or a goto action.');
  }

  const visitedOrigins = new Set<string>();
  const network: WorkflowRunNetworkActivity[] = [];
  const blockedRequests: string[] = [];
  const actionResults: Array<Record<string, unknown>> = [];
  const extracts: Record<string, unknown> = {};
  const screenshots: string[] = [];

  const recordNetwork = (url: URL, method: string) => {
    if (!shouldTrackNetwork(url)) {
      return;
    }

    const key = `${method}:${url.origin}`;

    if (visitedOrigins.has(key)) {
      return;
    }

    visitedOrigins.add(key);
    network.push({
      kind: 'browser',
      method,
      target: url.origin
    });
  };

  const browser = await playwright.chromium.launch({
    headless: asBoolean(context.node.config.headless) ?? true,
    timeout: context.timeoutMs
  });
  const handleAbort = () => {
    void browser.close().catch(() => undefined);
  };

  context.signal.addEventListener('abort', handleAbort, { once: true });

  try {
    const browserContext = await browser.newContext({
      extraHTTPHeaders: isRecord(context.node.config.extraHTTPHeaders)
        ? Object.fromEntries(Object.entries(context.node.config.extraHTTPHeaders).map(([key, value]) => [key, String(value)]))
        : undefined,
      ignoreHTTPSErrors: asBoolean(context.node.config.ignoreHTTPSErrors) ?? false,
      locale: asString(context.node.config.locale) ?? undefined,
      storageState: (await resolveStorageState(
        context.node.config.storageState,
        context.config.repoRoot
      )) as import('playwright').BrowserContextOptions['storageState'],
      userAgent: asString(context.node.config.userAgent) ?? undefined,
      viewport:
        isRecord(context.node.config.viewport) && asNumber(context.node.config.viewport.width) && asNumber(context.node.config.viewport.height)
          ? {
              height: asNumber(context.node.config.viewport.height)!,
              width: asNumber(context.node.config.viewport.width)!
            }
          : undefined
    });

    try {
      await browserContext.route('**/*', async (route) => {
        const requestUrl = new URL(route.request().url());

        if (shouldTrackNetwork(requestUrl) && context.config.privacyMode === 'strict-local' && !isLoopbackHostname(requestUrl.hostname)) {
          blockedRequests.push(requestUrl.origin);
          await route.abort('blockedbyclient');
          return;
        }

        recordNetwork(requestUrl, route.request().method());
        await route.continue();
      });

      const page = await browserContext.newPage();

      const gotoUrl = async (rawUrl: string, waitUntil?: string, timeoutOverride?: number) => {
        throwIfAborted(context.signal);
        const parsedUrl = assertBrowserUrlAllowed(context.config, rawUrl);
        await page.goto(parsedUrl.toString(), {
          timeout: timeoutOverride ?? context.timeoutMs,
          waitUntil:
            waitUntil === 'domcontentloaded' || waitUntil === 'networkidle' || waitUntil === 'commit' ? waitUntil : 'load'
        });
      };

      if (initialUrl) {
        await gotoUrl(initialUrl, asString(context.node.config.waitUntil) ?? undefined, asNumber(context.node.config.timeoutMs) ?? undefined);
      }

      for (const action of actions) {
        throwIfAborted(context.signal);
        const actionType = normalizeActionType(asString(action.type) ?? '');
        const actionTimeout = asNumber(action.timeoutMs) ?? context.timeoutMs;

        switch (actionType) {
          case 'goto': {
            const rawUrl = asString(action.url) ?? asString(action.to);

            if (!rawUrl) {
              throw new Error('Goto actions require url or to.');
            }

            await gotoUrl(rawUrl, asString(action.waitUntil) ?? undefined, actionTimeout);
            actionResults.push({ type: 'goto', url: rawUrl });
            break;
          }
          case 'click': {
            const selector = asString(action.selector);

            if (!selector) {
              throw new Error('Click actions require selector.');
            }

            await page.click(selector, { timeout: actionTimeout });
            actionResults.push({ selector, type: 'click' });
            break;
          }
          case 'fill': {
            const selector = asString(action.selector);
            const value = asString(action.value);

            if (!selector || value === null) {
              throw new Error('Fill actions require selector and value.');
            }

            await page.fill(selector, value, { timeout: actionTimeout });
            actionResults.push({ selector, type: 'fill', valueLength: value.length });
            break;
          }
          case 'press': {
            const selector = asString(action.selector);
            const key = asString(action.key);

            if (!selector || !key) {
              throw new Error('Press actions require selector and key.');
            }

            await page.press(selector, key, { timeout: actionTimeout });
            actionResults.push({ key, selector, type: 'press' });
            break;
          }
          case 'select': {
            const selector = asString(action.selector);
            const value = action.value;

            if (!selector) {
              throw new Error('Select actions require selector.');
            }

            if (Array.isArray(value)) {
              await page.selectOption(
                selector,
                value.filter((entry): entry is string => typeof entry === 'string'),
                { timeout: actionTimeout }
              );
            } else if (typeof value === 'string') {
              await page.selectOption(selector, value, { timeout: actionTimeout });
            } else {
              throw new Error('Select actions require value or value[].');
            }

            actionResults.push({ selector, type: 'select' });
            break;
          }
          case 'wait-for-selector':
          case 'waitforselector': {
            const selector = asString(action.selector);

            if (!selector) {
              throw new Error('Wait-for-selector actions require selector.');
            }

            await page.waitForSelector(selector, {
              state:
                asString(action.state) === 'attached' ||
                asString(action.state) === 'detached' ||
                asString(action.state) === 'hidden'
                  ? (asString(action.state) as 'attached' | 'detached' | 'hidden')
                  : 'visible',
              timeout: actionTimeout
            });
            actionResults.push({ selector, type: 'wait-for-selector' });
            break;
          }
          case 'wait-for-load-state':
          case 'waitforloadstate': {
            const state = asString(action.state);
            await page.waitForLoadState(state === 'domcontentloaded' || state === 'networkidle' ? state : 'load', {
              timeout: actionTimeout
            });
            actionResults.push({ state: state ?? 'load', type: 'wait-for-load-state' });
            break;
          }
          case 'wait':
          case 'wait-for-timeout':
          case 'waitfortimeout': {
            const durationMs = asNumber(action.durationMs) ?? asNumber(action.ms) ?? asNumber(action.timeoutMs);

            if (!durationMs) {
              throw new Error('Wait actions require durationMs, ms, or timeoutMs.');
            }

            await page.waitForTimeout(durationMs);
            actionResults.push({ durationMs, type: 'wait' });
            break;
          }
          case 'extract': {
            const name = asString(action.name) ?? asString(action.selector) ?? `extract-${Object.keys(extracts).length + 1}`;
            const value = await extractValue(page, action, context.timeoutMs);
            extracts[name] = value;
            actionResults.push({ name, type: 'extract', value });
            break;
          }
          case 'screenshot': {
            const screenshotPath = await saveScreenshot(page, context.config.repoRoot, action);
            screenshots.push(screenshotPath);
            actionResults.push({ path: screenshotPath, type: 'screenshot' });
            break;
          }
          default:
            throw new Error(`Unsupported browser automation action ${actionType || '(missing type)'}.`);
        }

        throwIfAborted(context.signal);
      }

      if (asString(context.node.config.screenshotPath)) {
        throwIfAborted(context.signal);
        const screenshotPath = await saveScreenshot(page, context.config.repoRoot, {
          fullPage: context.node.config.screenshotFullPage,
          path: context.node.config.screenshotPath,
          quality: context.node.config.screenshotQuality,
          type: context.node.config.screenshotType
        });

        screenshots.push(screenshotPath);
      }

      const finalUrl = page.url();
      const title = await page.title().catch(() => null);
      const html = asBoolean(context.node.config.captureHtml) === true ? truncateText(await page.content()) : null;
      const textSelector = asString(context.node.config.captureTextSelector);
      const text = textSelector ? await extractValue(page, { selector: textSelector }, context.timeoutMs) : null;
      throwIfAborted(context.signal);

      context.log('info', 'Completed browser automation run.', {
        finalUrl,
        requests: network.length,
        title
      });

      return {
        network,
        output: {
          actions: actionResults,
          blockedRequests: [...new Set(blockedRequests)],
          extracts,
          finalUrl,
          html,
          provider: 'playwright',
          screenshots,
          text,
          title
        }
      };
    } finally {
      await browserContext.close().catch(() => undefined);
    }
  } finally {
    context.signal.removeEventListener('abort', handleAbort);
    await browser.close().catch(() => undefined);
  }
}