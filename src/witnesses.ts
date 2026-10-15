import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger, PayRecord } from '../contracts/managed/pay-parity/contract/index.js';

// everything here stays on the employer's machine and never reaches the chain
export type EmployerPrivateState = {
  readonly secret: Uint8Array;
  readonly batch: PayRecord[];
  readonly salt: Uint8Array;
};

export const witnesses = {
  employerSecret: ({ privateState }: WitnessContext<Ledger, EmployerPrivateState>): [EmployerPrivateState, Uint8Array] => [
    privateState,
    privateState.secret,
  ],
  payBatch: ({ privateState }: WitnessContext<Ledger, EmployerPrivateState>): [EmployerPrivateState, PayRecord[]] => [
    privateState,
    privateState.batch,
  ],
  batchSalt: ({ privateState }: WitnessContext<Ledger, EmployerPrivateState>): [EmployerPrivateState, Uint8Array] => [
    privateState,
    privateState.salt,
  ],
};
