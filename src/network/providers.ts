import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import type { ImpureCircuits } from '../../contracts/index.js';
import type { PayParityProviders } from '../chain.js';
import type { NetworkConfig } from './config.js';
import type { MidnightWalletProvider } from './wallet.js';

type PayParityCircuits = keyof ImpureCircuits<unknown>;

export function buildProviders(
  wallet: MidnightWalletProvider,
  zkConfigPath: string,
  config: NetworkConfig,
  storeName = `pay-parity-${Date.now()}`,
): PayParityProviders {
  const zkConfigProvider = new NodeZkConfigProvider<PayParityCircuits>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: storeName,
      // the store wants a password with a few capitals and symbols
      privateStoragePasswordProvider: () => 'PayParity-Test-Password!',
      accountId: wallet.getCoinPublicKey(),
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: wallet,
    midnightProvider: wallet,
  };
}
