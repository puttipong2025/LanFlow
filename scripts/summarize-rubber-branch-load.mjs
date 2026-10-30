import fs from 'node:fs';
import assert from 'node:assert/strict';

const cpu = value => Number(value?.match(/^usage_usec (\d+)$/m)?.[1] ?? NaN);
const repeat = process.argv[2] ?? '';
assert.ok(['','r3'].includes(repeat));
const rows = [];
for (const transport of ['load','http']) for (const clients of [40,80]) {
  const suffix = transport === 'http' && repeat ? '-'+repeat : '';
  const get = label => JSON.parse(fs.readFileSync(`output/rubber-branch-${transport}-${label}${suffix}-${clients}.json`));
  const control = get('control'), candidate = get('candidate');
  assert.equal(control.expectedCommands, candidate.expectedCommands);
  assert.equal(control.confirmed, control.expectedCommands);
  assert.equal(candidate.confirmed, candidate.expectedCommands);
  assert.deepEqual(control.errors, []); assert.deepEqual(candidate.errors, []);
  const count = version => Object.values(version.operations).reduce((n,x) => n+x.calls,0);
  const cpuDelta = version => transport === 'load' ? (cpu(version.after.cpu)-cpu(version.before.cpu))/1000 : null;
  rows.push({ transport, clients, commands: candidate.expectedCommands,
    artifacts: { control: `rubber-branch-${transport}-control${suffix}-${clients}.json`,
      candidate: `rubber-branch-${transport}-candidate${suffix}-${clients}.json` },
    controlMedianMs: control.medianMs, candidateMedianMs: candidate.medianMs,
    controlP95Ms: control.p95Ms, candidateP95Ms: candidate.p95Ms,
    medianChangePct: 100*(candidate.medianMs/control.medianMs-1),
    p95ChangePct: 100*(candidate.p95Ms/control.p95Ms-1),
    controlCalls: count(control), candidateCalls: count(candidate),
    controlReadRetries: control.readRetries?.length ?? 0, candidateReadRetries: candidate.readRetries?.length ?? 0,
    controlContainerCpuMs: cpuDelta(control), candidateContainerCpuMs: cpuDelta(candidate) });
}
const result = { httpRepeat: repeat, limitation: 'Local logical clients, not 80 rendered browser tabs. Different actor models for SQL and HTTP; compare only within matching transport/client count. CPU is whole-container usage, not per-function attribution. SQL is a single paired sample; r3 HTTP runs candidate before reversed control, retaining previous failed/tail-regression artifacts separately.', rows };
fs.writeFileSync('output/rubber-branch-load-comparison.json', JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
