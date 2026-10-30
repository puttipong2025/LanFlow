import fs from 'node:fs';
import assert from 'node:assert/strict';

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  assert.ok(sorted.length && sorted.every(Number.isFinite));
  return Math.round(sorted[Math.ceil(sorted.length * p) - 1]);
};
const stats = values => ({ p50: percentile(values, 0.5), p95: percentile(values, 0.95) });
const summary = [];
for (const tabs of [1, 3]) {
  const stages = {};
  for (const stage of ['baseline', 'candidate']) {
    const data = JSON.parse(fs.readFileSync(`output/rubber-resume-perf-${stage}-${tabs}.json`, 'utf8'));
    assert.equal(data.tabs, tabs); assert.equal(data.stage, stage); assert.equal(data.samples.length, 3);
    for (const sample of data.samples) {
      assert.equal(sample.outcomes.length, tabs);
      assert.ok(sample.outcomes.every(outcome => outcome.status === 'synced'));
    }
    const warm = data.samples.filter(sample => sample.round > 0);
    stages[stage] = {
      cold: data.samples[0],
      openMs: stats(warm.map(sample => sample.openMs)),
      feedbackMs: stats(warm.flatMap(sample => sample.feedbackMs)),
      admissionMs: stats(warm.flatMap(sample => sample.outcomes.map(outcome => outcome.admissionMs))),
      completionMs: stats(warm.flatMap(sample => sample.completionMs)),
      workerMs: stats(warm.flatMap(sample => sample.outcomes.map(outcome => outcome.workerMs))),
      requests: Object.fromEntries(['open', 'idle', 'work', 'resume'].map(phase =>
        [phase, warm.reduce((total, sample) => total + sample.requests[phase], 0)])),
    };
  }
  const failures = [];
  if (stages.candidate.feedbackMs.p95 > 1000) failures.push('feedbackMs');
  for (const metric of ['openMs', 'admissionMs', 'completionMs']) for (const p of ['p50', 'p95']) {
    if (stages.candidate[metric][p] > Math.max(1000, stages.baseline[metric][p] * 2)) failures.push(`${metric}.${p}`);
  }
  for (const phase of ['open', 'idle', 'work', 'resume']) {
    if (stages.candidate.requests[phase] > stages.baseline.requests[phase] * 1.5 + 12) failures.push(`requests.${phase}`);
  }
  summary.push({ tabs, ...stages, failures });
}
fs.writeFileSync('output/rubber-resume-performance-summary.json', JSON.stringify({
  note: 'Two warm rounds after separately retained startup. Small descriptive Local samples; requests include all /api traffic, not only Rubber.',
  summary,
}, null, 2));
console.log(JSON.stringify(summary.map(({ tabs, baseline, candidate, failures }) => ({
  tabs, baseline: { feedback: baseline.feedbackMs, completion: baseline.completionMs, requests: baseline.requests },
  candidate: { feedback: candidate.feedbackMs, completion: candidate.completionMs, requests: candidate.requests }, failures,
})), null, 2));
assert.ok(summary.every(row => row.failures.length === 0), 'A local regression gate failed; inspect the saved summary');
