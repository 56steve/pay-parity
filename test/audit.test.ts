import { describe, expect, it } from 'vitest';
import { AuditSimulator } from '../src/simulator.js';
import { categoryId, toBatch, BATCH_SIZE, type Worker } from '../src/payroll.js';

const secret = new Uint8Array(32).fill(7);
const salt = new Uint8Array(32).fill(1);
const engineers = categoryId('engineers-2026');

const team = (men: number[], women: number[]): Worker[] => [
  ...men.map((salary): Worker => ({ salary, gender: 'male' })),
  ...women.map((salary): Worker => ({ salary, gender: 'female' })),
];

describe('pay gap verdict', () => {
  it('passes when women are paid within 5% of men', () => {
    const sim = new AuditSimulator(secret);
    const entry = sim.submit(engineers, 2026, team([100_000, 100_000], [98_000, 97_000]), salt);
    expect(entry.compliant).toBe(true);
    expect(entry.headcount).toBe(4n);
  });

  it('fails when the gap is well above 5%', () => {
    const sim = new AuditSimulator(secret);
    const entry = sim.submit(engineers, 2026, team([100_000, 100_000], [85_000, 85_000]), salt);
    expect(entry.compliant).toBe(false);
  });

  it('treats exactly 5% as non-compliant, as the directive says "5% or more"', () => {
    const sim = new AuditSimulator(secret);
    const entry = sim.submit(engineers, 2026, team([100, 100], [95, 95]), salt);
    expect(entry.compliant).toBe(false);
  });

  it('passes one unit under the 5% line', () => {
    const sim = new AuditSimulator(secret);
    const entry = sim.submit(engineers, 2026, team([100, 100], [96, 95]), salt);
    expect(entry.compliant).toBe(true);
  });

  it('passes when women earn more than men', () => {
    const sim = new AuditSimulator(secret);
    const entry = sim.submit(engineers, 2026, team([80_000, 82_000], [95_000, 99_000]), salt);
    expect(entry.compliant).toBe(true);
  });

  it('compares averages, so unequal group sizes still work', () => {
    const sim = new AuditSimulator(secret);
    // men avg 100k, women avg 97k (3% gap) with three women and two men
    const entry = sim.submit(engineers, 2026, team([100_000, 100_000], [97_000, 97_000, 97_000]), salt);
    expect(entry.compliant).toBe(true);
    expect(entry.headcount).toBe(5n);
  });

  it('ignores the unused slots of a partial batch', () => {
    const sim = new AuditSimulator(secret);
    const entry = sim.submit(engineers, 2026, team([100, 100], [100, 100]), salt);
    expect(entry.headcount).toBe(4n);
    expect(toBatch(team([100, 100], [100, 100]))).toHaveLength(BATCH_SIZE);
  });

  it('handles a full batch of maximum salaries without overflow', () => {
    const max = 2 ** 32 - 1;
    const sim = new AuditSimulator(secret);
    const entry = sim.submit(engineers, 2026, team([max, max, max, max], [max, max, max, max]), salt);
    expect(entry.compliant).toBe(true);
    expect(entry.headcount).toBe(8n);
  });
});

describe('rejected audits', () => {
  it('rejects a group of one so a verdict cannot expose a salary', () => {
    const sim = new AuditSimulator(secret);
    expect(() => sim.submit(engineers, 2026, team([100, 100], [100]), salt)).toThrow(
      'each group needs at least two people',
    );
  });

  it('rejects a batch with nobody in it', () => {
    const sim = new AuditSimulator(secret);
    expect(() => sim.submit(engineers, 2026, [], salt)).toThrow('each group needs at least two people');
  });

  it('rejects anyone but the employer', () => {
    const sim = new AuditSimulator(secret);
    const intruder = new Uint8Array(32).fill(9);
    expect(() => sim.submit(engineers, 2026, team([100, 100], [100, 100]), salt, intruder)).toThrow(
      'only the employer can submit audits',
    );
  });

  it('leaves the ledger untouched after a rejection', () => {
    const sim = new AuditSimulator(secret);
    expect(() => sim.submit(engineers, 2026, team([100], [100]), salt)).toThrow();
    expect(sim.ledger().submissions).toBe(0n);
    expect(sim.log()).toHaveLength(0);
  });

  it('rejects more people than a batch can hold', () => {
    const tooMany = team([1, 2, 3, 4, 5], [1, 2, 3, 4]);
    expect(() => toBatch(tooMany)).toThrow('a batch holds at most 8 people');
  });

  it('rejects salaries that do not fit the circuit', () => {
    expect(() => toBatch([{ salary: -1, gender: 'male' }])).toThrow('salary must be a whole number');
    expect(() => toBatch([{ salary: 1.5, gender: 'male' }])).toThrow('salary must be a whole number');
    expect(() => toBatch([{ salary: 2 ** 32, gender: 'male' }])).toThrow('salary must be a whole number');
  });
});

describe('audit log', () => {
  it('appends every attempt, so a failed audit cannot be retried away', () => {
    const sim = new AuditSimulator(secret);
    sim.submit(engineers, 2026, team([100, 100], [80, 80]), salt);
    sim.submit(engineers, 2026, team([100, 100], [99, 99]), salt);

    const log = sim.log();
    expect(sim.ledger().submissions).toBe(2n);
    expect(log.map((e) => e.compliant)).toEqual([false, true]);
  });

  it('keeps the log in submission order however many entries there are', () => {
    const sim = new AuditSimulator(secret);
    const years = Array.from({ length: 12 }, (_, i) => 2000 + i);
    for (const year of years) sim.submit(engineers, year, team([100, 100], [100, 100]), salt);

    expect(sim.log().map((e) => Number(e.period))).toEqual(years);
    expect(sim.numberedLog().map((e) => e.seq)).toEqual(years.map((_, i) => i));
  });

  it('records the category and period of each entry', () => {
    const sim = new AuditSimulator(secret);
    const designers = categoryId('designers-2026');
    sim.submit(engineers, 2026, team([100, 100], [100, 100]), salt);
    sim.submit(designers, 2027, team([100, 100], [100, 100]), salt);

    const [first, second] = sim.log();
    expect(first.category).toEqual(engineers);
    expect(second.category).toEqual(designers);
    expect(first.period).toBe(2026n);
    expect(second.period).toBe(2027n);
  });

  it('fixes the employer at deployment', () => {
    const sim = new AuditSimulator(secret);
    expect(sim.ledger().employer).toHaveLength(32);
  });
});

describe('privacy', () => {
  it('commits to the payroll so it cannot be swapped after the fact', () => {
    const sim = new AuditSimulator(secret);
    const a = sim.submit(engineers, 2026, team([100, 100], [99, 99]), salt);
    const b = sim.submit(engineers, 2026, team([100, 100], [99, 98]), salt);
    expect(a.commitment).not.toEqual(b.commitment);
  });

  it('is hiding: the same payroll under a new salt gives a different commitment', () => {
    const sim = new AuditSimulator(secret);
    const a = sim.submit(engineers, 2026, team([100, 100], [99, 99]), salt);
    const b = sim.submit(engineers, 2026, team([100, 100], [99, 99]), new Uint8Array(32).fill(2));
    expect(a.commitment).not.toEqual(b.commitment);
  });

  it('is binding: the same payroll and salt always reproduce the commitment', () => {
    const one = new AuditSimulator(secret).submit(engineers, 2026, team([100, 100], [99, 99]), salt);
    const two = new AuditSimulator(secret).submit(engineers, 2026, team([100, 100], [99, 99]), salt);
    expect(one.commitment).toEqual(two.commitment);
  });

  it('exposes only verdict, headcount, category, period and commitment', () => {
    const sim = new AuditSimulator(secret);
    const entry = sim.submit(engineers, 2026, team([123_457, 223_457], [111_111, 99_999]), salt);
    expect(Object.keys(entry).sort()).toEqual(['category', 'commitment', 'compliant', 'headcount', 'period']);
  });

  it('keeps individual salaries out of the public ledger state', () => {
    const salaries = [123_457, 223_457, 111_111, 99_999];
    const sim = new AuditSimulator(secret);
    sim.submit(engineers, 2026, team(salaries.slice(0, 2), salaries.slice(2)), salt);

    const dump = sim.publicStateDump().toLowerCase();
    expect(dump.length).toBeGreaterThan(0);
    for (const salary of salaries) {
      // as decimal, and as the little-endian bytes the chain stores integers in
      const hex = salary.toString(16).padStart(8, '0');
      const littleEndian = hex.match(/../g)!.reverse().join('').replace(/(00)+$/, '');
      expect(dump).not.toContain(String(salary));
      expect(dump).not.toContain(littleEndian);
    }
  });

  it('gives the same public footprint whatever the salaries, apart from the commitment', () => {
    const cheap = new AuditSimulator(secret).submit(engineers, 2026, team([50, 50], [49, 49]), salt);
    const rich = new AuditSimulator(secret).submit(engineers, 2026, team([900_000, 900_000], [890_000, 890_000]), salt);
    const { commitment: _a, ...cheapPublic } = cheap;
    const { commitment: _b, ...richPublic } = rich;
    expect(cheapPublic).toEqual(richPublic);
  });
});
