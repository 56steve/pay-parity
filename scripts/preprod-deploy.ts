// Deploys the contract to Preprod (or reuses the saved deployment), submits two
// audits with real proofs, reads the result back through the indexer, and writes
// the public evidence to deployments/preprod.json. No secrets go in that file.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openSession } from '../src/network/session.js';
import { categoryId } from '../src/payroll.js';
import { readNumberedLog, submitAuditOnChain } from '../src/chain.js';
import type { Worker } from '../src/payroll.js';

process.env['MIDNIGHT_NETWORK'] ??= 'preprod';

const team = (men: number[], women: number[]): Worker[] => [
  ...men.map((salary): Worker => ({ salary, gender: 'male' })),
  ...women.map((salary): Worker => ({ salary, gender: 'female' })),
];

const AUDITS = [
  { category: 'Software engineers', period: 2026, workers: team([112_000, 104_000, 118_000], [108_000, 101_000, 110_000]) },
  { category: 'Product designers', period: 2026, workers: team([98_000, 104_000, 112_000], [84_000, 84_000, 84_000]) },
];

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const text = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0+$/, '');

const session = await openSession();
try {
  const submitted: Array<{ category: string; period: number; txId: string; blockHeight: number }> = [];
  const existing = await readNumberedLog(session.providers, session.address);

  for (const a of AUDITS) {
    if (existing.some((e) => text(e.entry.category) === a.category && Number(e.entry.period) === a.period)) {
      session.logger.info(`already on chain: ${a.category} ${a.period}`);
      continue;
    }
    session.logger.info(`submitting ${a.category} ${a.period} (proof generation takes a while)...`);
    const { txId, blockHeight } = await submitAuditOnChain(
      session.providers,
      session.address,
      session.employerSecret,
      categoryId(a.category),
      a.period,
      a.workers,
    );
    submitted.push({ category: a.category, period: a.period, txId, blockHeight });
    session.logger.info(`  tx ${txId} in block ${blockHeight}`);
  }

  // what a regulator would read, straight from the indexer
  const log = await readNumberedLog(session.providers, session.address);
  const evidence = {
    network: session.network,
    contractAddress: session.address,
    employerAuthority: hex(session.authority),
    deploy: session.deployTxId ? { txId: session.deployTxId, blockHeight: session.deployBlock } : undefined,
    audits: log.map(({ seq, entry }) => ({
      seq,
      category: text(entry.category),
      period: Number(entry.period),
      verdict: entry.compliant ? 'under 5%' : '5% or more',
      headcount: Number(entry.headcount),
      commitment: hex(entry.commitment),
      ...submitted.find((s) => s.category === text(entry.category) && s.period === Number(entry.period)),
    })),
    recordedAt: new Date().toISOString(),
  };

  const out = path.resolve('deployments', `${session.network}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
  session.logger.info(`wrote ${out}`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await session.stop();
}
