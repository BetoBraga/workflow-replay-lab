# After the Update · Workflow Replay Lab

**What if the same document arrives twice?** Run four fictional events and inspect the decision trace, the source evidence, and the expected outcome. The lab is designed for comparing reliability rules before translating them into an automation platform.

## Run it

Open [index.html](index.html) in a browser after cloning this repository. No dependencies, upload, sign-in, API key, company data or network calls are required for the simulation. The page's external portfolio links only open if you click them.

| Case | Input | Try it | Expected | Diagnose a mismatch |
| --- | --- | --- | --- | --- |
| Valid document | `evt-101`, `DOC-042` revision 1; page and quoted span present | Select **Valid document**, open **Inspect event** | 1 registry write, 0 review tasks | Verify normalized document ID, revision, and quoted source span. |
| Duplicate delivery | `evt-102`, same document and revision; original record seeded | Select **Duplicate delivery**; compare event ID with the first case | 0 new writes, 0 review tasks; original record remains | Key the write on document + revision, not the transport event ID. |
| Missing evidence | `evt-103`, page present, quoted span absent | Select **Missing evidence** | 0 writes, 1 review task | Never substitute a guessed span for missing evidence. |
| Unreadable PDF | `evt-104`, fixture marks parser output unreadable | Select **Unreadable PDF** | 0 writes, 1 review task; trace identifies parse failure | Distinguish parser failure from a document read successfully with insufficient evidence. |

The input is a JSON fixture, not an uploaded PDF. The lab simulates parser results and human-review routing; it does not implement a document parser, a review queue, an LLM, or persistent storage. Each run resets the ledger.

## Adapt the exercise to Copilot Studio or Power Automate

Use a test tenant and a disposable target. Start with a manual trigger and the two fixtures for valid and duplicate events. Map the document ID and revision to a normalized key and inspect that key before requesting a write. In a production design, enforce uniqueness at the durable write boundary and test simultaneous deliveries. Then add separate branches for a parse failure and insufficient source evidence before the write step. Route both to human review with distinct reason codes and hold the registry write. Use connector-specific licensing and permission checks in your own tenant.

**Validation status:** the browser-local JavaScript rules are tested. No Copilot Studio or Power Automate tenant run is claimed. This does not use exported company flows or records.

## Tests

```sh
node --test tests/replay.test.cjs
```

To propose an edge case, share a minimal fictional input, the desired result and why the key or evidence rule should change. A useful starting point: same document ID, new revision.
