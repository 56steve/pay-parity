import { Gender, type PayRecord } from '../contracts/managed/pay-parity/contract/index.js';

export const BATCH_SIZE = 8;
export const MAX_SALARY = 2 ** 32 - 1;

export type Worker = { salary: number; gender: 'female' | 'male' };

const EMPTY_SLOT: PayRecord = { salary: 0n, gender: Gender.female, active: false };

// the circuit works on a fixed number of slots, unused ones are switched off
export function toBatch(workers: Worker[]): PayRecord[] {
  if (workers.length > BATCH_SIZE) {
    throw new Error(`a batch holds at most ${BATCH_SIZE} people, got ${workers.length}`);
  }
  const records = workers.map((w): PayRecord => {
    if (!Number.isInteger(w.salary) || w.salary < 0 || w.salary > MAX_SALARY) {
      throw new Error(`salary must be a whole number between 0 and ${MAX_SALARY}`);
    }
    return {
      salary: BigInt(w.salary),
      gender: w.gender === 'female' ? Gender.female : Gender.male,
      active: true,
    };
  });
  while (records.length < BATCH_SIZE) records.push({ ...EMPTY_SLOT });
  return records;
}

// category ids are 32 bytes on-chain, derived from a readable name + period
export function categoryId(name: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(name).slice(0, 32));
  return bytes;
}
