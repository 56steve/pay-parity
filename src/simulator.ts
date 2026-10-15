import {
  createConstructorContext,
  createCircuitContext,
  sampleContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  pureCircuits,
  type AuditResult,
  type Ledger,
} from '../contracts/managed/pay-parity/contract/index.js';
import { witnesses, type EmployerPrivateState } from './witnesses.js';
import { toBatch, type Worker } from './payroll.js';

const COIN_PUBLIC_KEY = '0'.repeat(64);

// runs the compiled contract in-process, no network or proof server needed
export class AuditSimulator {
  private readonly contract = new Contract<EmployerPrivateState>(witnesses);
  private context: CircuitContext<EmployerPrivateState>;
  readonly address = sampleContractAddress();

  constructor(private readonly secret: Uint8Array, employerAuthority = pureCircuits.authorityOf(secret)) {
    const initialPrivate: EmployerPrivateState = {
      secret,
      batch: toBatch([]),
      salt: new Uint8Array(32),
    };
    const init = this.contract.initialState(
      createConstructorContext(initialPrivate, COIN_PUBLIC_KEY),
      employerAuthority,
    );
    this.context = createCircuitContext(
      this.address,
      COIN_PUBLIC_KEY,
      init.currentContractState,
      init.currentPrivateState,
    );
  }

  // returns the new log entry, or throws if the contract rejects the audit
  submit(category: Uint8Array, period: number, workers: Worker[], salt: Uint8Array, secret = this.secret): AuditResult {
    const attempt: CircuitContext<EmployerPrivateState> = {
      ...this.context,
      currentPrivateState: { secret, batch: toBatch(workers), salt },
    };
    const before = this.ledger().submissions;
    const { context } = this.contract.impureCircuits.submitAudit(attempt, category, BigInt(period));
    this.context = context;
    return this.ledger().audits.lookup(before);
  }

  ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }

  // the full public state as the chain would hold it, for privacy checks
  publicStateDump(): string {
    return this.context.currentQueryContext.state.toString();
  }

  log(): AuditResult[] {
    return [...this.ledger().audits].map(([, entry]) => entry);
  }
}
