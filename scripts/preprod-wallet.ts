// Mints one Preprod wallet and writes it to the git-ignored .env.preprod.
// Needs BLOCKFROST_PROJECT_ID to already be in that file (or the shell).
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { WalletSeeds } from '@midnight-ntwrk/testkit-js';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk/unshielded';
import { getChainTipHeight, redactUrl } from '@midnight-ntwrk/example-fast-sync';
import { loadEnvFile } from '../src/network/env.js';
import { getConfig } from '../src/network/config.js';

process.env['MIDNIGHT_NETWORK'] = 'preprod';
const envPath = path.resolve('.env.preprod');
loadEnvFile('preprod');

if (existsSync(envPath) && /^MIDNIGHT_PREPROD_ALICE_SEED=/m.test(readFileSync(envPath, 'utf8'))) {
  console.log('A wallet already exists in .env.preprod. Not creating another; that seed is the only copy.');
  process.exit(0);
}

const config = getConfig();
setNetworkId(config.networkId);

const tip = await getChainTipHeight(config.indexer);
if (tip === undefined) {
  throw new Error(`Could not read the chain tip from ${redactUrl(config.indexer)}. Check BLOCKFROST_PROJECT_ID.`);
}

const seed = randomBytes(32).toString('hex');
const keystore = createKeystore(WalletSeeds.fromMasterSeed(seed).unshielded, config.networkId);
const address = String(keystore.getBech32Address());

// the birthday is what lets a brand-new wallet fast-sync instead of walking the whole chain
appendFileSync(
  envPath,
  [
    '',
    `# wallet minted ${new Date().toISOString()}, secret, git-ignored, the only copy`,
    `# address ${address}`,
    `MIDNIGHT_PREPROD_ALICE_SEED=${seed}`,
    `MIDNIGHT_PREPROD_ALICE_BIRTHDAY=${tip}`,
    '',
  ].join('\n'),
  { mode: 0o600 },
);

console.log(`\nWallet created (birthday ${tip}). The seed is stored in .env.preprod and never printed.`);
console.log(`\nFund this address with tNIGHT at the faucet:\n  ${config.faucet}\n\n  ${address}\n`);
