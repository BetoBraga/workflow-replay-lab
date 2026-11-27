# After the Update · Workflow Replay Lab

**What if the same document arrives twice?** Run fictional events and inspect the decision trace, source evidence, and saved ledger. The lab demonstrates local persistence, idempotent replay, and recovery after a committed write loses its acknowledgement. It is still a prototype for comparing reliability rules, not a production document workflow.

## Run it

Use Node.js 24 or later and run `node --test` to check the browser and SQLite exercises. For a stable browser storage origin, start `python -m http.server 8000` in the repository root and open `http://localhost:8000/`. This uses only Python's standard library and Node.js; the page only loads its same-origin static files and makes no external requests. Its only stored data is the fictional event ledger in this browser's `localStorage` for this local origin.

| Case | Input | Try it | Expected | Diagnose a mismatch |
| --- | --- | --- | --- | --- |
| Valid document | `evt-101`, `DOC-042` revision 1; page and quoted span present | Select **Valid document**, open **Inspect event** | 1 registry write, 0 review tasks | Verify normalized document ID, revision, and quoted source span. |
| Duplicate delivery | `evt-102`, same document and revision, different event ID | Select **Valid document**, then **Duplicate delivery**; reload and replay | 0 new writes after the first delivery; original record remains | Key the durable write on document + revision, not the transport event ID. |
| Missing evidence | `evt-103`, page present, quoted span absent | Select **Missing evidence** | 0 writes, 1 review task | Never substitute a guessed span for missing evidence. |
| Unreadable PDF | `evt-104`, fixture marks parser output unreadable | Select **Unreadable PDF** | 0 writes, 1 review task; trace identifies parse failure | Distinguish parser failure from a document read successfully with insufficient evidence. |
| Interrupted commit | `evt-105` and `evt-106`, same document revision and different event IDs | Select **Interrupt after durable write**, reload, then **Interrupted delivery replay** | First attempt is not acknowledged; retry creates no second record | The durable business key must outlive the delivery attempt. |

The input is a JSON fixture, not an uploaded PDF. The browser lab does not implement document parsing, a review queue, an LLM, a shared database, or transactional concurrency control. `localStorage` persists across reloads in one browser profile, but it is not a production write boundary. If the saved ledger is malformed or unsupported, the lab stops and leaves it untouched rather than reporting a successful write.

To exercise failure recovery, select **Interrupt after durable write**. The lab writes a valid fictional event and then drops its acknowledgement. Reload the page and replay the event: the stored document revision should be recognized as a duplicate with no second write. **Clear local ledger** removes only this lab's local browser entry after an explicit confirmation.

## Test the write boundary in SQLite

The browser exercise stays static. A separate Node example, `sqlite-replay.cjs`, uses a local SQLite file and a unique key on `(document_id, revision)`. The database decides whether a valid write wins, not a preflight lookup. Inputs use fictional, canonical document IDs and positive integer revisions.

```sh
node --test tests/sqlite-replay.test.cjs
```

Two separate processes start from the same test barrier, submit different delivery IDs for the same document revision, and leave exactly one row. A new revision adds another row; missing evidence does not. In a second test, a process exits after SQLite commits but before returning an acknowledgement. A new process retries and finds the committed row without rewriting it.

This tests a local database and process exit, not power loss, a network filesystem, or a Microsoft tenant. It does not add a persistent review queue or change the published browser exercise.

## Adapt the exercise to Copilot Studio or Power Automate

Use a test tenant and a disposable target. Start with a manual trigger and the two fixtures for valid and duplicate events. Map the document ID and revision to a normalized key and inspect that key before requesting a write. In a production design, enforce uniqueness at the durable write boundary and test simultaneous deliveries. Then add separate branches for a parse failure and insufficient source evidence before the write step. Route both to human review with distinct reason codes and hold the registry write. Use connector-specific licensing and permission checks in your own tenant.

**Validation status:** Node tests cover re-opening the file-backed adapter, duplicate delivery, malformed saved state, UI decisions, and an interruption after the shared ledger code commits. The local browser smoke check also confirmed that the browser ledger survives reload, duplicate and interrupted replays add no second record, and the explicit clear action removes only the lab ledger. No Copilot Studio or Power Automate tenant run is claimed. This does not use exported company flows or records.

## Tests

```sh
node --test
```

To propose an edge case, share a minimal fictional input, the desired result and why the key or evidence rule should change. A useful starting point: same document ID, new revision.
