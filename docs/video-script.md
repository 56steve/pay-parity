# Demo video script

Target length: 2 minutes 30 seconds. The recorded video in the submission is silent, with this text as on-screen captions. If you record your own voiceover instead, read it in your own words; the points matter more than the wording.

Before recording: run `npm run demo`, open http://127.0.0.1:3000, and click "Clear ledger" so it starts empty.

## 1. The problem (0:00 to 0:25)

Show slide 2.

> The EU Pay Transparency Directive says that if the gender pay gap in a job category is 5% or more, the employer has to do a joint pay assessment. To prove compliance, someone has to see the numbers. But payroll is sensitive, and in a small team even an average can point at one person.

## 2. The idea (0:25 to 0:50)

Show slide 3.

> Pay Parity lets an employer prove the gap is under 5% without revealing any salary. The public ledger gets a verdict, a headcount and a commitment to the payroll. Everything else stays on the employer's machine.

## 3. Demo, passing audit (0:50 to 1:25)

Switch to the browser. Click "Load example", then "Submit audit".

> This is the employer's view. Six people, three men and three women. I submit, and the public ledger on the right shows one line: software engineers, under 5%, six people, and a commitment hash. No salaries.

## 4. Demo, failing audit (1:25 to 1:50)

Change the category to "Product designers", lower the female salaries to 84000, submit.

> Now a category with a real gap. The contract records it as 5% or more. Failures stay on the record, so an employer can't keep retrying until one passes.

## 5. Demo, a rejection (1:50 to 2:05)

Remove two of the women so one remains, and submit.

> If a group has fewer than two people, the contract refuses. That's deliberate: a verdict on a group of one would expose that person's pay. Nothing is recorded.

## 6. How it works on Midnight (2:05 to 2:25)

Show slide 4.

> Pay records come in through witnesses, so they're private state. The circuit computes group sums and checks the 5% rule. Only the verdict and headcount are disclosed, and the compiler forces every disclosure to be explicit. A commitment binds the employer to the payroll they audited.

## 7. Close (2:25 to 2:40)

Show slide 6, then slide 8.

> The contract has 31 unit tests and 8 end-to-end tests that run on a local Midnight network, including one that reads the public state back and scans it for every salary. Next is deploying to Preprod, and larger payrolls.

## Notes

- Don't claim it's on a public network. It has run on a local Midnight network, not Preprod.
- If something fails on camera, say so and redo the take; the contract's error messages are part of the demo.
