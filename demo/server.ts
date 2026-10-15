import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditSimulator } from '../src/simulator.js';
import { categoryId, type Worker } from '../src/payroll.js';

// Employer-side backend for the demo. It keeps the payroll and the employer key
// on this machine and only ever returns what the public ledger holds.
//
//   npm run demo         runs the compiled contract in-process
//   npm run demo:chain   deploys it to a local Midnight network and sends every
//                        audit as a real transaction with a real ZK proof

const here = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(here, 'public', 'index.html');

type LedgerView = {
  employer: string;
  submissions: number;
  log: Array<{ seq: number; category: string; period: number; compliant: boolean; headcount: number; commitment: string }>;
};

type Backend = {
  mode: 'in-process' | 'chain';
  contract?: string;
  view(): Promise<LedgerView>;
  submit(name: string, period: number, workers: Worker[]): Promise<{ txId?: string }>;
  reset?(): Promise<void>;
};

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const text = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0+$/, '');

function localBackend(): Backend {
  const secret = new Uint8Array(randomBytes(32));
  let sim = new AuditSimulator(secret);
  return {
    mode: 'in-process',
    async view() {
      const ledger = sim.ledger();
      return {
        employer: hex(ledger.employer),
        submissions: Number(ledger.submissions),
        log: sim.numberedLog().map(({ seq, entry: e }) => ({
          seq,
          category: text(e.category),
          period: Number(e.period),
          compliant: e.compliant,
          headcount: Number(e.headcount),
          commitment: hex(e.commitment),
        })),
      };
    },
    async submit(name, period, workers) {
      sim.submit(categoryId(name), period, workers, new Uint8Array(randomBytes(32)));
      return {};
    },
    async reset() {
      sim = new AuditSimulator(secret);
    },
  };
}

async function chainBackend(): Promise<Backend> {
  // loaded on demand: pulls in the wallet SDK and WebAssembly runtime
  const { openSession } = await import('../src/network/session.js');
  const { readLedger, readNumberedLog, submitAuditOnChain } = await import('../src/chain.js');
  const session = await openSession();
  let queue: Promise<unknown> = Promise.resolve();

  return {
    mode: 'chain',
    contract: session.address,
    async view() {
      const ledger = await readLedger(session.providers, session.address);
      const log = await readNumberedLog(session.providers, session.address);
      return {
        employer: hex(ledger.employer),
        submissions: Number(ledger.submissions),
        log: log.map(({ seq, entry: e }) => ({
          seq,
          category: text(e.category),
          period: Number(e.period),
          compliant: e.compliant,
          headcount: Number(e.headcount),
          commitment: hex(e.commitment),
        })),
      };
    },
    submit(name, period, workers) {
      // one transaction at a time: the wallet can't spend the same coins twice
      const run = queue.then(async () => {
        const { txId } = await submitAuditOnChain(
          session.providers,
          session.address,
          session.employerSecret,
          categoryId(name),
          period,
          workers,
        );
        return { txId };
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100_000) reject(new Error('request too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseWorkers(input: unknown): Worker[] {
  if (!Array.isArray(input)) throw new Error('workers must be a list');
  return input.map((w, i) => {
    const { salary, gender } = w as { salary: unknown; gender: unknown };
    if (gender !== 'female' && gender !== 'male') throw new Error(`person ${i + 1}: pick female or male`);
    return { salary: Number(salary), gender };
  });
}

export function createApp(backend: Backend) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(readFileSync(pagePath));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/mode') {
        return send(res, 200, { mode: backend.mode, contract: backend.contract ?? null, canReset: Boolean(backend.reset) });
      }
      if (req.method === 'GET' && url.pathname === '/api/ledger') {
        return send(res, 200, await backend.view());
      }
      if (req.method === 'POST' && url.pathname === '/api/audits') {
        const body = JSON.parse(await readBody(req)) as { category?: string; period?: number; workers?: unknown };
        const name = String(body.category ?? '').trim();
        if (!name) throw new Error('enter a job category');
        if (new TextEncoder().encode(name).length > 32) throw new Error('category name must fit in 32 bytes');
        const period = Number(body.period);
        if (!Number.isInteger(period) || period < 2000 || period > 2100) throw new Error('period must be a year');

        const { txId } = await backend.submit(name, period, parseWorkers(body.workers));
        const ledger = await backend.view();
        return send(res, 200, { entry: ledger.log.at(-1), txId: txId ?? null, ledger });
      }
      if (req.method === 'POST' && url.pathname === '/api/reset') {
        if (!backend.reset) return send(res, 400, { error: 'a chain ledger can\'t be cleared' });
        await backend.reset();
        return send(res, 200, await backend.view());
      }
      send(res, 404, { error: 'not found' });
    } catch (err) {
      // contract assertions land here, e.g. "each group needs at least two people"
      const raw = err instanceof Error ? err.message : String(err);
      const message = err instanceof SyntaxError ? 'invalid request body' : cleanMessage(raw);
      send(res, 400, { error: message });
    }
  });
}

// the contract's own message, without the runtime's wrapping
function cleanMessage(raw: string): string {
  const known = ['each group needs at least two people', 'only the employer can submit audits'];
  const hit = known.find((m) => raw.includes(m));
  return hit ?? raw.replace(/^failed assert: /, '');
}

const backend = process.env.PAY_PARITY_MODE === 'chain' ? await chainBackend() : localBackend();
export const server = createApp(backend);

const port = Number(process.env.PORT ?? 3000);
server.listen(port, '127.0.0.1', () => {
  console.log(`pay-parity demo (${backend.mode}) on http://127.0.0.1:${port}`);
});
