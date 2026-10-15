import { randomBytes } from 'node:crypto';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  CompiledPayParityContract,
  Contract,
  ledger,
  pureCircuits,
  type AuditResult,
  type Ledger,
} from '../contracts/index.js';
import { toBatch, type Worker } from './payroll.js';
import type { EmployerPrivateState } from './witnesses.js';

export const PRIVATE_STATE_ID = 'payParityEmployer';

export type PayParityProviders = MidnightProviders<any>;

export function newEmployerSecret(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

// the employer deploys once; the secret behind their authority never leaves this machine
export async function deployAuditContract(
  providers: PayParityProviders,
  secret: Uint8Array,
): Promise<{ address: ContractAddress; deployed: DeployedContract<Contract> }> {
  const initialPrivateState: EmployerPrivateState = {
    secret,
    batch: toBatch([]),
    salt: new Uint8Array(32),
  };
  const deployed = await (deployContract<Contract>)(providers, {
    compiledContract: CompiledPayParityContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
    args: [pureCircuits.authorityOf(secret)],
  });
  return { address: deployed.deployTxData.public.contractAddress, deployed };
}

export type SubmittedAudit = {
  txId: string;
  blockHeight: number;
  // the employer needs this to open the commitment later, so it is handed back
  salt: Uint8Array;
};

export async function submitAuditOnChain(
  providers: PayParityProviders,
  address: ContractAddress,
  employerSecret: Uint8Array,
  category: Uint8Array,
  period: number,
  workers: Worker[],
  salt: Uint8Array = new Uint8Array(randomBytes(32)),
): Promise<SubmittedAudit> {
  // the witnesses read the payroll from private state, so stage it there first
  const staged: EmployerPrivateState = { secret: employerSecret, batch: toBatch(workers), salt };
  await providers.privateStateProvider.set(PRIVATE_STATE_ID, staged);

  const call = await (submitCallTx<Contract, 'submitAudit'>)(providers, {
    compiledContract: CompiledPayParityContract,
    contractAddress: address,
    privateStateId: PRIVATE_STATE_ID,
    circuitId: 'submitAudit',
    args: [category, BigInt(period)],
  });
  return { txId: call.public.txId, blockHeight: call.public.blockHeight, salt };
}

export async function readLedger(providers: PayParityProviders, address: ContractAddress): Promise<Ledger> {
  const state = await providers.publicDataProvider.queryContractState(address);
  if (!state) throw new Error(`no contract found at ${address}`);
  return ledger(state.data);
}

export async function readNumberedLog(
  providers: PayParityProviders,
  address: ContractAddress,
): Promise<Array<{ seq: number; entry: AuditResult }>> {
  const l = await readLedger(providers, address);
  // the ledger map doesn't iterate in insertion order, so order by sequence number
  return [...l.audits].map(([seq, entry]) => ({ seq: Number(seq), entry })).sort((a, b) => a.seq - b.seq);
}

export async function readAuditLog(providers: PayParityProviders, address: ContractAddress): Promise<AuditResult[]> {
  return (await readNumberedLog(providers, address)).map(({ entry }) => entry);
}
