import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { PermissionMode, ThinkingMode } from './types.js';

/**
 * CLI configuration resolution order (lowest → highest):
 *   defaults → ~/.joker/config.json → env vars → CLI flags
 * This mirrors codex's layered config without inventing a new runtime.
 */
export interface CliConfig {
  baseUrl: string;
  token: string;
  projectPath: string;
  mode: PermissionMode;
  thinking: ThinkingMode;
  model?: string;
  autoStartServer: boolean;
}

const CONFIG_DIR = join(homedir(), '.joker');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function readUserConfig(): Partial<CliConfig> {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Record<string, unknown>;
    return parsed as Partial<CliConfig>;
  } catch {
    return {};
  }
}

export interface CliOverrides {
  baseUrl?: string;
  token?: string;
  projectPath?: string;
  mode?: PermissionMode;
  thinking?: ThinkingMode;
  model?: string;
  noServerStart?: boolean;
}

const MODE_ALIASES: Record<string, PermissionMode> = {
  read_only: 'default',
  ask: 'default',
  auto: 'workspace_write',
  yolo: 'full_access',
  danger: 'full_access'
};

export function resolveConfig(overrides: CliOverrides = {}): CliConfig {
  const user = readUserConfig();
  const modeRaw = overrides.mode ?? user.mode;
  const mode = typeof modeRaw === 'string' ? (MODE_ALIASES[modeRaw] ?? modeRaw) : undefined;

  return {
    baseUrl: overrides.baseUrl ?? user.baseUrl ?? process.env.JOKER_URL ?? 'http://127.0.0.1:8787',
    token: overrides.token ?? user.token ?? process.env.AGENT_LOCAL_TOKEN ?? '',
    projectPath: resolve(overrides.projectPath ?? user.projectPath ?? process.cwd()),
    mode: isValidMode(mode) ? mode : 'workspace_write',
    thinking: overrides.thinking ?? user.thinking ?? 'balanced',
    model: overrides.model ?? user.model,
    autoStartServer: !(overrides.noServerStart ?? false)
  };
}

function isValidMode(mode: unknown): mode is PermissionMode {
  return (
    mode === 'default' ||
    mode === 'plan' ||
    mode === 'workspace_write' ||
    mode === 'full_access'
  );
}
