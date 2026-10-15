import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { resolveWallet } from '@midnight-ntwrk/example-fast-sync';
import pino from 'pino';

import { getConfig } from '../src/network/config.js';
import { MidnightWalletProvider, syncWallet } from '../src/network/wallet.js';
import { buildProviders } from '../src/network/providers.js';
import { pureCircuits, zkConfigPath } from '../contracts/index.js';
import {
  deployAuditContract,
  newEmployerSecret,
  readAuditLog,
  readLedger,
  submitAuditOnChain,
  type PayParityProviders,
} from '../src/chain.js';
import { AuditSimulator } from '../src/simulator.js';
import { categoryId, type Worker } from '../src/payroll.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const team = (men: number[], women: number[]): Worker[] => [
  ...men.map((salary): Worker => ({ salary, gender: 'male' })),
  ...women.map((salary): Worker => ({ salary, gender: 'female' })),
];

describe('Pay Parity contract (local network)', () => {
  let wallet: MidnightWalletProvider;
  let providers: PayParityProviders;
  let address: ContractAddress;

  const config = getConfig();
  const employerSecret = newEmployerSecret();
  const engineers = categoryId('engineers-2026');
  const designers = categoryId('designers-2026');

  beforeAll(async () => {
    setNetworkId(config.networkId);
    const env: EnvironmentConfiguration = {
      walletNetworkId: config.networkId,
      networkId: config.networkId,
      indexer: config.indexer,
      indexerWS: config.indexerWS,
      node: config.node,
      nodeWS: config.nodeWS,
      faucet: config.faucet,
      proofServer: config.proofServer,
    };

    // the genesis-funded dev wallet pays the fees, the employer key is separate
    const setup = resolveWallet('local');
    wallet = await MidnightWalletProvider.build(logger, env, setup.secret);
    await wallet.start();
    await syncWallet(logger, wallet.wallet, 10 * 60_000);
    providers = buildProviders(wallet, zkConfigPath, config);
  });

  afterAll(async () => {
    if (wallet) await wallet.stop();
  });

  it('deploys with the employer authority fixed in public state', async () => {
    ({ address } = await deployAuditContract(providers, employerSecret));
    logger.info(`deployed at ${address}`);

    const state = await readLedger(providers, address);
    expect(state.employer).toEqual(pureCircuits.authorityOf(employerSecret));
    expect(state.submissions).toBe(0n);
    expect(state.audits.isEmpty()).toBe(true);
  });

  it('records a compliant verdict from a real proof', async () => {
    await submitAuditOnChain(providers, address, employerSecret, engineers, 2026, team([100_000, 100_000], [98_000, 97_000]));

    const [entry] = await readAuditLog(providers, address);
    expect(entry.compliant).toBe(true);
    expect(entry.headcount).toBe(4n);
    expect(entry.category).toEqual(engineers);
    expect(entry.period).toBe(2026n);
    expect(entry.commitment).toHaveLength(32);
  });

  it('records a non-compliant verdict instead of hiding it', async () => {
    await submitAuditOnChain(providers, address, employerSecret, designers, 2026, team([100_000, 100_000], [80_000, 80_000]));

    const log = await readAuditLog(providers, address);
    expect(log).toHaveLength(2);
    expect(log.map((e) => e.compliant)).toEqual([true, false]);
    expect(log[1].category).toEqual(designers);
  });

  it('rejects a group of one before any proof is made', async () => {
    const before = (await readLedger(providers, address)).submissions;
    await expect(
      submitAuditOnChain(providers, address, employerSecret, engineers, 2026, team([100_000, 100_000], [90_000])),
    ).rejects.toThrow(/each group needs at least two people/);
    expect((await readLedger(providers, address)).submissions).toBe(before);
  });

  it('rejects anyone who is not the employer', async () => {
    const before = (await readLedger(providers, address)).submissions;
    await expect(
      submitAuditOnChain(providers, address, newEmployerSecret(), engineers, 2026, team([100, 100], [100, 100])),
    ).rejects.toThrow(/only the employer can submit audits/);
    expect((await readLedger(providers, address)).submissions).toBe(before);
  });

  it('keeps every salary out of the on-chain state', async () => {
    const salaries = [123_457, 223_457, 111_111, 99_999];
    await submitAuditOnChain(providers, address, employerSecret, engineers, 2027, team(salaries.slice(0, 2), salaries.slice(2)));

    const raw = await providers.publicDataProvider.queryContractState(address);
    const dump = raw!.data.toString().toLowerCase();
    for (const salary of salaries) {
      const hex = salary.toString(16).padStart(8, '0');
      const littleEndian = hex.match(/../g)!.reverse().join('').replace(/(00)+$/, '');
      expect(dump).not.toContain(String(salary));
      expect(dump).not.toContain(littleEndian);
    }
  });

  it('lets the employer later open a commitment against the real payroll', async () => {
    const workers = team([70_000, 71_000], [69_000, 70_500]);
    const { salt } = await submitAuditOnChain(providers, address, employerSecret, engineers, 2028, workers);

    const onChain = (await readAuditLog(providers, address)).at(-1)!;

    // replaying the same payroll and salt locally must reproduce the on-chain commitment
    const replay = new AuditSimulator(employerSecret).submit(engineers, 2028, workers, salt);
    expect(onChain.commitment).toEqual(replay.commitment);
    expect(onChain.compliant).toBe(replay.compliant);

    // a doctored payroll cannot
    const doctored = new AuditSimulator(employerSecret).submit(engineers, 2028, team([70_000, 71_000], [60_000, 60_000]), salt);
    expect(onChain.commitment).not.toEqual(doctored.commitment);
  });

  it('appends all attempts in order', async () => {
    const state = await readLedger(providers, address);
    expect(state.submissions).toBe(4n);
    const log = await readAuditLog(providers, address);
    expect(log.map((e) => Number(e.period))).toEqual([2026, 2026, 2027, 2028]);
  });
});
