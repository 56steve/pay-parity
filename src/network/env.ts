import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Reads `.env.<network>` from the repo root into process.env. Real values in the
// shell win, and the file is git-ignored because it holds wallet seeds.
export function loadEnvFile(network: string, dir = process.cwd()): void {
  const file = path.join(dir, `.env.${network}`);
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function networkName(): string {
  return process.env['MIDNIGHT_NETWORK'] ?? 'local';
}
