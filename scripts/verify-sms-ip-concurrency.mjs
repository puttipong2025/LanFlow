// Local database only. Model overlapping requests that hold separate stale IP
// buckets before entering cleanup. No HTTP requests, credentials or SMS.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const hashes = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
const bucketTime = process.env.SMS_IP_TEST_FRESH === '1' ? 'now()' : "now()-interval '3 hours'";
const args = ['exec', '-i', 'supabase_db_webapp', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const sql = text => execFileSync('docker', args, { input: text, encoding: 'utf8' });
const sessions = [];
try {
  sql(`insert into private.sms_ip_budgets(bucket_hash,window_started_at) values ${hashes.map(hash => `('${hash}',${bucketTime})`).join(',')};`);
  for (const hash of hashes) {
    const process = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const ready = new Promise((resolve, reject) => {
      process.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('LOCK_READY')) resolve(); });
      process.once('error', reject);
      process.once('exit', code => { if (!stdout.includes('LOCK_READY')) reject(new Error(`Session exited before lock: ${code}`)); });
    });
    process.stderr.on('data', chunk => { stderr += chunk; });
    const finished = new Promise(resolve => process.once('exit', code => resolve({ code, get deadlock() { return /deadlock detected/i.test(stderr); } })));
    sessions.push({ process, ready, finished });
    process.stdin.write(`begin; set local statement_timeout='8s'; select bucket_hash from private.sms_ip_budgets where bucket_hash='${hash}' for update; select 'LOCK_READY';\n`);
  }
  await Promise.all(sessions.map(session => session.ready));
  sessions.forEach((session, index) => session.process.stdin.end(`select public.claim_sms_ip_budget('${hashes[index]}'); commit;\n`));
  const results = await Promise.all(sessions.map(session => session.finished));
  console.log(`IP cleanup concurrent sessions: ${results.filter(result => result.code === 0).length}/2 completed; deadlocks=${results.filter(result => result.deadlock).length}`);
  assert.ok(results.every(result => result.code === 0), 'Concurrent IP cleanup must not deadlock or time out');
  assert.equal(sql(`select count(*) from private.sms_ip_budgets where bucket_hash in (${hashes.map(hash => `'${hash}'`).join(',')}) and sends=1;`).trim(), '2');
} finally {
  for (const session of sessions) session.process.stdin.destroy();
  sql(`delete from private.sms_ip_budgets where bucket_hash in (${hashes.map(hash => `'${hash}'`).join(',')});`);
}
