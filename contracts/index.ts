// Entry point for the compiled contract. The imports below resolve against
// contracts/managed/pay-parity, which `npm run compile` generates.
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export {
  Contract,
  Gender,
  ledger,
  pureCircuits,
  type AuditResult,
  type PayRecord,
  type Ledger,
  type ImpureCircuits,
} from './managed/pay-parity/contract/index.js';
import { Contract } from './managed/pay-parity/contract/index.js';
import { witnesses } from '../src/witnesses.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const zkConfigPath = path.resolve(currentDir, 'managed', 'pay-parity');

export const CompiledPayParityContract = CompiledContract.make('PayParityContract', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
