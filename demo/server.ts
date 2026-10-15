import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditSimulator } from '../src/simulator.js';
import { categoryId, type Worker } from '../src/payroll.js';

// Employer-side backend for the demo. It keeps the payroll and the employer key
// in memory, runs the compiled Compact contract, and only ever returns what the
// public ledger would hold.

const here = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(here, 'public', 'index.html');

const secret = new Uint8Array(randomBytes(32));
let sim = new AuditSimulator(secret);

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

function publicView() {
  const ledger = sim.ledger();
  return {
    employer: hex(ledger.employer),
    submissions: Number(ledger.submissions),
    log: sim.numberedLog().map(({ seq, entry: e }) => ({
      seq,
      category: new TextDecoder().decode(e.category).replace(/\0+$/, ''),
      period: Number(e.period),
      compliant: e.compliant,
      headcount: Number(e.headcount),
      commitment: hex(e.commitment),
    })),
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

export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(pagePath));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/ledger') {
      return send(res, 200, publicView());
    }
    if (req.method === 'POST' && url.pathname === '/api/audits') {
      const body = JSON.parse(await readBody(req)) as { category?: string; period?: number; workers?: unknown };
      const name = String(body.category ?? '').trim();
      if (!name) throw new Error('enter a job category');
      if (new TextEncoder().encode(name).length > 32) throw new Error('category name must fit in 32 bytes');
      const period = Number(body.period);
      if (!Number.isInteger(period) || period < 2000 || period > 2100) throw new Error('period must be a year');

      const salt = new Uint8Array(randomBytes(32));
      sim.submit(categoryId(name), period, parseWorkers(body.workers), salt);
      const view = publicView();
      return send(res, 200, { entry: view.log.at(-1), ledger: view });
    }
    if (req.method === 'POST' && url.pathname === '/api/reset') {
      sim = new AuditSimulator(secret);
      return send(res, 200, publicView());
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    // contract assertions land here, e.g. "each group needs at least two people"
    const raw = err instanceof Error ? err.message : String(err);
    const message = err instanceof SyntaxError ? 'invalid request body' : raw.replace(/^failed assert: /, '');
    send(res, 400, { error: message });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, '127.0.0.1', () => {
  console.log(`pay-parity demo on http://127.0.0.1:${port}`);
});
