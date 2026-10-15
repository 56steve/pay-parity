// Starts the demo against a local Midnight network (see `npm run env:up`).
process.env.PAY_PARITY_MODE = 'chain';
await import('./server.js');

export {};
