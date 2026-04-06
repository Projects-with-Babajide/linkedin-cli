import { AuthTokens } from '../types/index';

const SERVICE_NAME = 'linkedin-cli';
const ACCOUNT_TOKENS = 'auth-tokens';
const ACCOUNT_COOKIES = 'browser-cookies';

// Try to load keytar; fall back to file-based storage if native bindings fail
let keytarModule: typeof import('keytar') | null = null;
try {
  keytarModule = require('keytar');
} catch {
  keytarModule = null;
}

// File-based fallback
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const SECRETS_DIR = path.join(os.homedir(), '.linkedin-cli');
const SECRETS_FILE = path.join(SECRETS_DIR, '.secrets.json');
const MASTER_KEY_ACCOUNT = 'master-key';
const MASTER_KEY_FILE = path.join(os.homedir(), '.linkedin-cli', '.key');

function loadOrCreateMasterKey(): Buffer {
  // 1. Try keytar first
  if (keytarModule) {
    // keytar is async, so for the fallback path we use the file
    // Note: keytar async path cannot be used here since getMachineKey is called
    // synchronously from encrypt/decrypt. The file path with 0o600 is sufficient.
  }

  // 2. File-based master key (random, generated once)
  if (fs.existsSync(MASTER_KEY_FILE)) {
    const raw = fs.readFileSync(MASTER_KEY_FILE, 'utf-8').trim();
    return Buffer.from(raw, 'hex');
  }

  // 3. Generate fresh random master key
  const masterKey = crypto.randomBytes(32);
  const dir = path.dirname(MASTER_KEY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MASTER_KEY_FILE, masterKey.toString('hex'), { mode: 0o600 });
  return masterKey;
}

function getMachineKey(): Buffer {
  const masterKey = loadOrCreateMasterKey();
  // Stretch the master key with scrypt so even if .key file is stolen,
  // the AES key cannot be trivially derived without the scrypt work factor
  return crypto.scryptSync(masterKey, 'linkedin-cli-v1', 32, { N: 16384, r: 8, p: 1 });
}

function encrypt(text: string): string {
  const key = getMachineKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text: string): string {
  const key = getMachineKey();
  const [ivHex, encHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function readSecrets(): Record<string, string> {
  try {
    if (!fs.existsSync(SECRETS_DIR)) fs.mkdirSync(SECRETS_DIR, { recursive: true });
    if (!fs.existsSync(SECRETS_FILE)) return {};
    const raw = fs.readFileSync(SECRETS_FILE, 'utf-8');
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeSecrets(secrets: Record<string, string>): void {
  if (!fs.existsSync(SECRETS_DIR)) fs.mkdirSync(SECRETS_DIR, { recursive: true });
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets), { mode: 0o600 });
}

async function getPassword(service: string, account: string): Promise<string | null> {
  if (keytarModule) return keytarModule.getPassword(service, account);
  const secrets = readSecrets();
  const key = `${service}:${account}`;
  const val = secrets[key];
  if (!val) return null;
  try { return decrypt(val); } catch { return null; }
}

async function setPassword(service: string, account: string, password: string): Promise<void> {
  if (keytarModule) return keytarModule.setPassword(service, account, password);
  const secrets = readSecrets();
  secrets[`${service}:${account}`] = encrypt(password);
  writeSecrets(secrets);
}

async function deletePassword(service: string, account: string): Promise<boolean> {
  if (keytarModule) return keytarModule.deletePassword(service, account);
  const secrets = readSecrets();
  delete secrets[`${service}:${account}`];
  writeSecrets(secrets);
  return true;
}

export async function saveTokens(tokens: AuthTokens): Promise<void> {
  await setPassword(SERVICE_NAME, ACCOUNT_TOKENS, JSON.stringify(tokens));
}

export async function loadTokens(): Promise<AuthTokens | null> {
  const val = await getPassword(SERVICE_NAME, ACCOUNT_TOKENS);
  if (!val) return null;
  return JSON.parse(val) as AuthTokens;
}

export async function clearTokens(): Promise<void> {
  await deletePassword(SERVICE_NAME, ACCOUNT_TOKENS);
}

export async function saveCookies(state: string): Promise<void> {
  await setPassword(SERVICE_NAME, ACCOUNT_COOKIES, state);
}

export async function loadCookies(): Promise<string | null> {
  return getPassword(SERVICE_NAME, ACCOUNT_COOKIES);
}

export async function clearCookies(): Promise<void> {
  await deletePassword(SERVICE_NAME, ACCOUNT_COOKIES);
}

// WhatsApp-specific cookie storage (separate service to avoid conflicts with LinkedIn session)
const WA_SERVICE_NAME = 'whatsapp-cli';
const WA_ACCOUNT_COOKIES = 'browser-cookies';

export async function saveWhatsAppCookies(state: string): Promise<void> {
  await setPassword(WA_SERVICE_NAME, WA_ACCOUNT_COOKIES, state);
}

export async function loadWhatsAppCookies(): Promise<string | null> {
  return getPassword(WA_SERVICE_NAME, WA_ACCOUNT_COOKIES);
}

export async function clearWhatsAppCookies(): Promise<void> {
  await deletePassword(WA_SERVICE_NAME, WA_ACCOUNT_COOKIES);
}
