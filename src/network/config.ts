import { getConfig as harnessConfig, type NetworkConfig } from '@midnight-ntwrk/example-fast-sync';
import { loadEnvFile, networkName } from './env.js';

export type { NetworkConfig };

// `local` is the Docker network from compose.yml. `preprod` goes through
// Blockfrost and needs BLOCKFROST_PROJECT_ID in the git-ignored .env.preprod.
export function getConfig(): NetworkConfig {
  const network = networkName();
  loadEnvFile(network);
  return harnessConfig(network);
}
