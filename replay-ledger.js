/* Small storage boundary shared by the browser lab and its Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReplayLedger = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const STORAGE_KEY = 'after-the-update:ledger:v1';

  class InterruptedAfterCommit extends Error {
    constructor(key) {
      super('The durable write completed before acknowledgement was interrupted.');
      this.name = 'InterruptedAfterCommit';
      this.key = key;
    }
  }

  function businessKey(event) {
    return `${event.documentId}:${event.revision}`;
  }

  function readRecords(storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Saved ledger data is unreadable. It was left untouched.');
    }
    if (
      !parsed || parsed.version !== 1 || !Array.isArray(parsed.records) ||
      parsed.records.some(record => !record || typeof record.key !== 'string' ||
        typeof record.eventId !== 'string' || typeof record.documentId !== 'string' ||
        !Number.isInteger(record.revision))
    ) {
      throw new Error('Saved ledger data has an unsupported shape. It was left untouched.');
    }
    return parsed.records;
  }

  function processEvent(storage, event, options = {}) {
    const key = businessKey(event);
    const records = readRecords(storage);
    const existing = records.find(record => record.key === key);
    if (existing) {
      return { result: 'duplicate', key, before: records.length, after: records.length, writes: 0, reviews: 0, records };
    }
    if (event.parseStatus === 'unreadable') {
      return { result: 'review', key, before: records.length, after: records.length, writes: 0, reviews: 1, records };
    }
    const evidence = event.evidence || {};
    if (!Number.isInteger(evidence.page) || evidence.page < 1 || typeof evidence.span !== 'string' || !evidence.span.trim()) {
      return { result: 'review', key, before: records.length, after: records.length, writes: 0, reviews: 1, records };
    }

    const record = {
      key,
      eventId: event.eventId,
      documentId: event.documentId,
      revision: event.revision,
      page: evidence.page,
      span: evidence.span,
    };
    const next = [...records, record];
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, records: next }));
    if (options.interruptAfterCommit) throw new InterruptedAfterCommit(key);
    return { result: 'registered', key, before: records.length, after: next.length, writes: 1, reviews: 0, records: next };
  }

  return { STORAGE_KEY, InterruptedAfterCommit, businessKey, readRecords, processEvent };
});
