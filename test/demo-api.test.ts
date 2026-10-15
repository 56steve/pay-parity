import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.PORT = '0';
const { server } = await import('../demo/server.js');

let base = '';
const json = async (res: Response): Promise<any> => res.json();

beforeAll(async () => {
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const audit = (category: string, men: number[], women: number[]) => ({
  category,
  period: 2026,
  workers: [
    ...men.map((salary) => ({ salary, gender: 'male' })),
    ...women.map((salary) => ({ salary, gender: 'female' })),
  ],
});

describe('demo api', () => {
  it('starts with an empty public ledger', async () => {
    await post('/api/reset', {});
    const view = await json(await fetch(base + '/api/ledger'));
    expect(view.submissions).toBe(0);
    expect(view.log).toEqual([]);
  });

  it('records a verdict and returns only public fields', async () => {
    const res = await post('/api/audits', audit('Engineers', [100_000, 100_000], [98_000, 97_000]));
    expect(res.status).toBe(200);
    const { entry, ledger } = await json(res);
    expect(entry).toMatchObject({ category: 'Engineers', period: 2026, compliant: true, headcount: 4 });
    expect(ledger.submissions).toBe(1);

    const everything = JSON.stringify({ entry, ledger });
    for (const salary of ['100000', '98000', '97000']) expect(everything).not.toContain(salary);
  });

  it('records a failing verdict alongside the passing one', async () => {
    await post('/api/audits', audit('Designers', [100_000, 100_000], [80_000, 80_000]));
    const view = await json(await fetch(base + '/api/ledger'));
    expect(view.log.map((e: { compliant: boolean }) => e.compliant)).toEqual([true, false]);
  });

  it('returns the contract message when an audit is rejected, and records nothing', async () => {
    const before = (await json(await fetch(base + '/api/ledger'))).submissions;
    const res = await post('/api/audits', audit('Solo', [100, 100], [100]));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('each group needs at least two people');
    expect((await json(await fetch(base + '/api/ledger'))).submissions).toBe(before);
  });

  it('rejects malformed input with a readable message', async () => {
    const noName = await post('/api/audits', { ...audit('x', [1, 1], [1, 1]), category: '  ' });
    expect((await json(noName)).error).toBe('enter a job category');

    const badYear = await post('/api/audits', { ...audit('x', [1, 1], [1, 1]), period: 1850 });
    expect((await json(badYear)).error).toBe('period must be a year');

    const badSalary = await post('/api/audits', audit('x', [-5, 1], [1, 1]));
    expect((await json(badSalary)).error).toMatch(/salary must be a whole number/);

    const garbage = await fetch(base + '/api/audits', { method: 'POST', body: '{nope' });
    expect((await json(garbage)).error).toBe('invalid request body');
  });

  it('serves the page and 404s unknown routes', async () => {
    const page = await fetch(base + '/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Pay Parity');
    expect((await fetch(base + '/nope')).status).toBe(404);
  });
});
