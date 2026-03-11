import * as fs from 'fs/promises';
import * as path from 'path';
import { CACHE_DIR, ensureConfigDir } from './config';
import { getContext } from '../utils/context';

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

export async function getCached<T>(key: string, ttlMs: number): Promise<T | null> {
  if (getContext().noCache) return null;
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    const raw = await fs.readFile(file, 'utf-8');
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.cachedAt > ttlMs) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCached<T>(key: string, data: T): Promise<void> {
  await ensureConfigDir();
  const file = path.join(CACHE_DIR, `${key}.json`);
  const entry: CacheEntry<T> = { data, cachedAt: Date.now() };
  await fs.writeFile(file, JSON.stringify(entry));
}
