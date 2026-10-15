// Reads the deployed contract straight from the public Preprod indexer, with no
// wallet and no secrets, and checks what a stranger could see: the audit log, and
// that none of the salaries behind it appear anywhere in the public state.
//
//   npm run preprod:verify                 uses deployments/preprod.json
//   npm run preprod:verify -- <address>    checks any deployed address
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { ledger } from '../contracts/index.js';
import { getConfig } from '../src/network/config.js';

// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;
process.env['MIDNIGHT_NETWORK'] ??= 'preprod';

const config = getConfig();
setNetworkId(config.networkId);

const saved = JSON.parse(readFileSync(path.resolve('deployments', `${process.env['MIDNIGHT_NETWORK']}.json`), 'utf8'));
const address: string = process.argv[2] ?? saved.contractAddress;

const provider = indexerPublicDataProvider(config.indexer, config.indexerWS);
const state = await provider.queryContractState(address);
if (!state) {
  console.error(`No contract found at ${address} on ${config.networkId}.`);
  process.exit(1);
}

const l = ledger(state.data);
const text = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0+$/, '');
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

console.log(`network   ${config.networkId}`);
console.log(`contract  ${address}`);
console.log(`employer  ${hex(l.employer)}`);
console.log(`audits    ${l.submissions}`);
for (const [seq, e] of [...l.audits].sort(([a], [b]) => (a < b ? -1 : 1))) {
  console.log(`  #${seq}  ${text(e.category)}  ${e.period}  ${e.compliant ? 'under 5%' : '5% or more'}  ${e.headcount} people  commitment ${hex(e.commitment).slice(0, 16)}...`);
}

// every salary used in the deploy script, as decimals and as the little-endian bytes the ledger stores
const salaries = [112_000, 104_000, 118_000, 108_000, 101_000, 110_000, 98_000, 84_000];
const dump = state.data.toString().toLowerCase();
let leaks = 0;
for (const s of salaries) {
  const le = s.toString(16).padStart(8, '0').match(/../g)!.reverse().join('').replace(/(00)+$/, '');
  if (dump.includes(String(s)) || dump.includes(le)) {
    console.error(`LEAK: salary ${s} appears in the public state`);
    leaks++;
  }
}
console.log(leaks === 0 ? `\nchecked ${salaries.length} salaries: none appear in the public state` : `\n${leaks} leak(s) found`);
process.exit(leaks === 0 ? 0 : 1);
