import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CliConfig } from '../types/index';
import { CliException, ErrorCode } from '../utils/errors';

export const CONFIG_DIR = path.join(os.homedir(), '.linkedin-cli');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const CACHE_DIR = path.join(CONFIG_DIR, 'cache');

export async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

export async function readConfig(): Promise<CliConfig | null> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as CliConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(config: CliConfig): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function requireConfig(): Promise<CliConfig> {
  const config = await readConfig();
  if (!config) {
    throw new CliException(
      `No config found. Create ${CONFIG_FILE} with clientId, clientSecret, and redirectPort.`,
      ErrorCode.CONFIG_ERROR
    );
  }
  return config;
}
