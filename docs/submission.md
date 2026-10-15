# Wave 2 submission notes

Text for the AKINDO form. Edit freely.

## Project

Pay Parity: prove that the gender pay gap in a job category is under 5% without publishing any salary.

Repository: https://github.com/56steve/pay-parity

Live on Midnight Preprod, contract address (search it at https://preprod.midnightexplorer.com/):
f4e684d9e05b892e8427cba2296e08a96c0086cd12fe5c618c3c53064add8d05

## Description

Under the EU Pay Transparency Directive, an unexplained gender pay gap of 5% or more in a job category triggers a joint pay assessment. Evidencing compliance normally means handing payroll to an auditor, which is sensitive and leaves no tamper-evident record.

Pay Parity is a Compact contract where the employer submits up to eight pay records as private state. The circuit computes the average pay per group, checks that each group has at least two people (so a verdict can't expose one person's pay), and checks that average female pay is above 95% of average male pay. The public ledger records only the verdict, the headcount, the category and year, and a commitment to the payroll. Every attempt, passing or failing, is appended to a log, so an audit can't be retried until it passes.

Midnight features used: private state through witnesses, explicit `disclose()` at each point where something becomes public, a sealed employer authority on the ledger, a public append-only map, and `persistentCommit` to bind the employer to the audited payroll.

## Progress completed in this Wave

This is a new project started in Wave 2.

- Compact contract (`contracts/pay-parity.compact`) compiling on the 0.31.1 toolchain pinned by the Preprod support matrix
- 31 unit tests covering verdicts, the exact 5% boundary, rejections, the append-only log and its ordering, commitment properties, and a check that no salary appears in public state
- 8 end-to-end tests against a local Midnight network (node, indexer and proof server in Docker): a real deploy, audits submitted with real zero-knowledge proofs, rejections before any proof is made, the public state read back from the indexer and scanned for salaries, and the on-chain commitment reproduced from the payroll and salt
- Deployed to Midnight Preprod with two audits recorded by real transactions (deploy in block 2997492, audits in blocks 2997498 and 2997505). The values are in `deployments/preprod.json`, and `npm run preprod:verify` reads the contract back through the public indexer and checks that none of the salaries behind it appear in the public state
- Employer-side demo backend and web UI, with two modes: in-process, or every audit sent as a proven transaction to the local network
- CI that compiles, typechecks and tests on every push, plus an on-demand end-to-end workflow
- README, slide deck and a captioned demo video (silent, with the script as on-screen captions)

## Known limits

- The Preprod audits use made-up pay data. Nothing here attests a real payroll yet.
- The contract proves that the supplied data meets the rule; it can't know the data is the true payroll.
- One audit covers up to eight people.

## Next (Wave 3)

Pilot with a real payroll export, combine several batches into one verdict, check signed payroll exports in the circuit, and add an employee self-check with a Merkle inclusion proof.

## Checklist

- [ ] Repository is public
- [ ] Repository has the `midnightntwrk` topic
- [ ] Apache-2.0 license is in the repo (it is)
- [ ] Slide deck: `docs/pay-parity-deck.pptx`
- [ ] Demo video uploaded and linked
