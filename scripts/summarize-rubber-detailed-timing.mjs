import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const input = JSON.parse(readFileSync('output/rubber-timing-browser.json', 'utf8'));
assert.equal(input.samples.length, 3, 'Require three complete command traces');
const rows = input.samples.sort((a, b) => a.round - b.round).map(sample => {
  const { browser, server, pdfCompletedAtMs, pdfBytes, injectedLock } = sample.details;
  const commandId = sample.commandIds[0];
  assert.equal(server.commandId, commandId);
  assert.equal(server.synchronousCommit, 'on');
  const event = kind => { const item = browser.find(item => item.kind === kind); assert.ok(item, `Missing ${kind}`); return item; };
  const span = kind => { const item = server.spans.find(item => item.kind === kind); assert.ok(item, `Missing ${kind}`); return item; };
  const click = event('click').atMs;
  const durable = browser.find(item => item.kind === 'outbox-commit' && item.commandId === commandId);
  const acknowledged = browser.find(item => item.kind === 'acknowledgement-commit' && item.commandId === commandId);
  assert.ok(durable && acknowledged, 'Require both native IndexedDB commits for the same command');
  const post = span('post-handler');
  const auth = server.spans.find(item => item.kind === 'auth' && item.startMs >= post.startMs && item.endMs <= post.endMs);
  const contextAuth = server.spans.find(item => item.kind === 'auth' && item.endMs < post.startMs);
  assert.ok(auth && contextAuth, 'Both real auth guards must execute');
  const duration = item => item.endMs - item.startMs;
  const worker = span('worker-statement');
  const locks = server.locks;
  const gaps = locks.slice(1).map((item, i) => item.sampledAtMs - locks[i].sampledAtMs);
  const first = locks.findIndex(item => item.waiting), last = locks.findLastIndex(item => item.waiting);
  let observedLockEpisode = null;
  if (first >= 0) {
    assert.ok(injectedLock, 'An unexpected lock needs investigation');
    observedLockEpisode = {
      lowerMs: Math.max(0, locks[last].sampledAtMs - locks[first].sampledAtMs),
      upperMs: first > 0 && last < locks.length - 1
        ? Math.min(duration(worker), locks[last + 1].sampledAtMs - locks[first - 1].sampledAtMs)
        : duration(worker),
      censored: first === 0 || last === locks.length - 1,
    };
    assert.ok(observedLockEpisode.lowerMs > 0 && observedLockEpisode.upperMs >= observedLockEpisode.lowerMs);
  }
  assert.equal(first >= 0, injectedLock, 'The injected wait must be observed');
  assert.ok(pdfCompletedAtMs < span('submit_rubber_queue').startMs, 'Local PDF must precede server admission in this gated diagnostic');
  assert.ok(server.commitAcknowledgedMs > server.commitDispatchedMs);
  assert.ok(event('confirmed-ui-dom').atMs >= server.commitAcknowledgedMs);
  return {
    commandId, round: sample.round + 1, injectedLock,
    clickToDisabledMs: event('button-disabled').atMs - click,
    clickToLocalDurableMs: durable.atMs - click,
    contextHttpMs: event('context-http').durationMs,
    contextAuthMs: duration(contextAuth), contextRpcMs: duration(span('get_rubber_bill_command_context')),
    postAuthMs: duration(auth), admissionRpcCommitAckMs: duration(span('submit_rubber_queue')),
    admissionAckToWorkerDispatchMs: worker.startMs - span('submit_rubber_queue').endMs,
    workerStatementMs: duration(worker), observedLockEpisode,
    lockSamplingMaxGapMs: gaps.length ? Math.max(...gaps) : duration(worker),
    commitDispatchToAckMs: server.commitAcknowledgedMs - server.commitDispatchedMs,
    receiptReadMs: duration(span('get_rubber_queue')),
    receiptReadToLocalAckMs: acknowledged.atMs - span('get_rubber_queue').endMs,
    localAckToConfirmedDomMs: event('confirmed-ui-dom').atMs - acknowledged.atMs,
    clickToConfirmedDomMs: event('confirmed-ui-dom').atMs - click,
    clickToPdfCompleteMs: pdfCompletedAtMs - click, pdfBytes,
  };
});
assert.equal(new Set(rows.map(row => row.commandId)).size, 3);
const limitations = [
  'Test-only probes; actual browser/native IDB/PDF and production Route/auth/RPC/worker/driver execute against Local Supabase.',
  'Queue/context requests are intercepted and invoke source handlers in the test process with the same session bearer credential. This excludes Next middleware/cookie adaptation and is not an HTTP performance benchmark.',
  'Cron is temporarily paused and restored. PDF completion gates admission; round2 injects a locations-row FK lock released after an observed wait. These deliberate gates must not be interpreted as normal queue latency.',
  'Worker statement includes guards, receipt writes, network overhead and lock waits. COMMIT dispatch-to-ack includes protocol overhead; synchronous_commit=on was verified. Durations overlap and must not be summed.',
  'Lock polling brackets the observed episode; short waits can fall between samples. No observed wait is not zero lock time. The bounds are not a complete attribution of every PostgreSQL lock.',
  'UI DOM observation precedes a paint opportunity, not physical display/print completion. PDF is a completed, nonempty %PDF- browser download; no printer, human share sheet or external recipient is timed.',
];
writeFileSync('output/rubber-detailed-timing-summary.json', JSON.stringify({ environment: input.environment, rows, limitations }, null, 2));
const f = value => value.toFixed(2);
const metrics = [
  ['Button lock after click', 'clickToDisabledMs'], ['Native local durable commit after click', 'clickToLocalDurableMs'],
  ['Context HTTP boundary', 'contextHttpMs'], ['Context real auth guard', 'contextAuthMs'], ['Context RPC', 'contextRpcMs'],
  ['Admission real auth guard', 'postAuthMs'], ['Admission RPC through commit ACK', 'admissionRpcCommitAckMs'],
  ['Admission ACK to worker dispatch', 'admissionAckToWorkerDispatchMs'], ['Worker statement, including locks', 'workerStatementMs'],
  ['COMMIT dispatch to ACK', 'commitDispatchToAckMs'], ['Authoritative receipt read', 'receiptReadMs'],
  ['Receipt read end to native local acknowledgement', 'receiptReadToLocalAckMs'], ['Local acknowledgement to confirmed DOM observation', 'localAckToConfirmedDomMs'],
  ['Click to confirmed DOM observation', 'clickToConfirmedDomMs'], ['Click to completed local PDF download', 'clickToPdfCompleteMs'],
];
const lines = ['## Detailed timing closure — Local diagnostic', '',
  'Three separate create commands bind every stage to the same immutable UUID in each trace. Values below are milliseconds. Round2 deliberately holds a row lock; PDF delivery is deliberately completed before admission. Existing unmodified HTTP benchmark results remain the speed evidence.', '',
  '| Measured interval | Round1 | Round2, injected lock | Round3 |', '| --- | ---: | ---: | ---: |',
  ...metrics.map(([label, key]) => `| ${label} | ${rows.map(row => f(row[key])).join(' | ')} |`), '',
  `Observed lock episode in round2: ${f(rows[1].observedLockEpisode.lowerMs)}–${f(rows[1].observedLockEpisode.upperMs)}ms; edge-censored=${rows[1].observedLockEpisode.censored}. Maximum lock sample gaps by round: ${rows.map(row => f(row.lockSamplingMaxGapMs)).join('/')}ms. Other rounds observed no Lock event; this is not a zero-duration assertion.`, '',
  `Completed PDFs: ${rows.map(row => row.pdfBytes).join('/')} bytes. All commands have exact synced outcomes/attempt1, authoritative committed receipt, native IDB acknowledgement and confirmed UI. No payloads, customer names, tokens or PDF contents are retained in timing artifacts.`, '',
  ...limitations.map(item => `- ${item}`), '',
  'Reproduce: set `RUBBER_DETAILED_TIMING=1`, run `npx playwright test --config=playwright.rubber-performance.config.ts --grep "save 1 independent"`, then `node scripts/summarize-rubber-detailed-timing.mjs`. The probe code is test-only; no new product or database instrumentation is deployed.', '',
  'Raw ignored evidence: `output/rubber-timing-browser.json`, `output/rubber-detailed-timing-summary.json`, `output/rubber-detailed-timing-final.log`. The first probe attempt used a Node performance alias inside page.evaluate and failed before recording samples; using window.performance corrected that harness error. The subsequent real-path trace passed before the stricter DOM/commit-mode assertions were added.', '',
];
writeFileSync('output/rubber-detailed-timing.md', lines.join('\n'));
console.log(JSON.stringify({ commands: rows.length, allStagesBoundToIdentity: true, observedLockEpisode: rows[1].observedLockEpisode,
  buttonLockMs: rows.map(row => row.clickToDisabledMs), commitAckMs: rows.map(row => row.commitDispatchToAckMs) }));
