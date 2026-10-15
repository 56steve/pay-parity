import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import pino, { type Logger } from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { resolveWallet, waitForNightThenDust } from '@midnight-ntwrk/example-fast-sync';
import { pureCircuits, zkConfigPath } from '../../contracts/index.js';
import {
  deployAuditContract,
  newEmployerSecret,
  PRIVATE_STATE_ID,
  type PayParityProviders,
} from '../chain.js';
import { getConfig, type NetworkConfig } from './config.js';
import { networkName } from './env.js';
import { buildProviders } from './providers.js';
import { MidnightWalletProvider, syncWallet } from './wallet.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const STATE_DIR = path.resolve('.midnight-state');

type Deployment = {
  address: ContractAddress;
  employerSecretHex: string;
  networkId: string;
  deployTxId?: string;
  deployBlock?: number;
};

export type Session = {
  providers: PayParityProviders;
  address: ContractAddress;
  employerSecret: Uint8Array;
  authority: Uint8Array;
  config: NetworkConfig;
  network: string;
  deployedNow: boolean;
  deployTxId?: string;
  deployBlock?: number;
  logger: Logger;
  stop: () => Promise<void>;
};

const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const fromHex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));

// Connects the employer's machine to the network: wallet for fees, providers,
// and one deployed contract that is reused across restarts. The employer key is
// kept in .midnight-state/ (git-ignored), next to the address it controls.
export async function openSession(
  logger: Logger = pino({ level: 'info', transport: { target: 'pino-pretty' } }),
): Promise<Session> {
  const network = networkName();
  const config = getConfig();
  const remote = network !== 'local';
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

  const setup = resolveWallet(network);
  const wallet = await MidnightWalletProvider.build(logger, env, setup.secret, { fastSync: setup.fastSync });
  await wallet.start();
  await syncWallet(logger, wallet.wallet, remote ? 60 * 60_000 : 10 * 60_000);

  if (remote) {
    // synced is not funded: wait for tNIGHT from the faucet, then for DUST to accrue
    await waitForNightThenDust(logger, wallet.wallet, wallet.unshieldedKeystore, env, config.faucet, {
      label: setup.role,
    });
  }

  const providers = buildProviders(wallet, zkConfigPath, config, `pay-parity-${network}`);

  const deploymentFile = path.join(STATE_DIR, `deployment.${network}.json`);
  let deployment: Deployment | undefined;
  if (existsSync(deploymentFile)) {
    const saved = JSON.parse(readFileSync(deploymentFile, 'utf8')) as Deployment;
    // a restarted local network has no memory of the old contract
    if (saved.networkId === config.networkId && (await providers.publicDataProvider.queryContractState(saved.address))) {
      deployment = saved;
    }
  }

  let employerSecret: Uint8Array;
  let address: ContractAddress;
  let deployedNow = false;
  let deployTxId = deployment?.deployTxId;
  let deployBlock = deployment?.deployBlock;
  if (deployment) {
    employerSecret = fromHex(deployment.employerSecretHex);
    address = deployment.address;
    logger.info(`reusing contract at ${address}`);
  } else {
    employerSecret = newEmployerSecret();
    logger.info('deploying a fresh contract...');
    const result = await deployAuditContract(providers, employerSecret);
    address = result.address;
    deployTxId = result.txId;
    deployBlock = result.blockHeight;
    deployedNow = true;
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(
      deploymentFile,
      JSON.stringify(
        { address, employerSecretHex: toHex(employerSecret), networkId: config.networkId, deployTxId, deployBlock } satisfies Deployment,
        null,
        2,
      ),
      { mode: 0o600 },
    );
    logger.info(`deployed at ${address}`);
  }

  return {
    providers,
    address,
    employerSecret,
    authority: pureCircuits.authorityOf(employerSecret),
    config,
    network,
    deployedNow,
    deployTxId,
    deployBlock,
    logger,
    stop: () => wallet.stop(),
  };
}

export { PRIVATE_STATE_ID };
