// Explicit, local-only handset acceptance. Enter the received code on stdin;
// never put it in an argument, log, screenshot, or saved test artifact.
import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

assert.equal(process.env.RUN_REAL_SMS_TEST, '1', 'Explicit opt-in required');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.match(url || '', /^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const auth = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const base = process.env.SMS_TEST_BASE || 'http://127.0.0.1:3001';
assert.match(base, /^http:\/\/127\.0\.0\.1:(3001|3107)$/);
let user;
let input;
let stage = 'fixture';
try {
  const existing = await admin.from('profiles').select('id').eq('phone', '0641545551');
  assert.equal(existing.error, null);
  assert.equal(existing.data.length, 0, 'Test phone already belongs to a local profile; stop without changing it');
  const password = crypto.randomUUID();
  const created = await admin.auth.admin.createUser({ phone: '+66641545551', password, phone_confirm: true });
  assert.equal(created.error, null);
  user = created.data.user.id;
  assert.equal((await admin.from('profiles').insert({ id: user, phone: '0641545551', name: 'Handset acceptance fixture', role: 'admin', is_active: true })).error, null);
  const actor = await admin.from('profiles').select('id').eq('role', 'super_admin').single();
  assert.equal(actor.error, null);
  assert.equal((await admin.rpc('set_user_sms_required', { p_actor: actor.data.id, p_target: user, p_required: true })).error, null);
  const signed = await auth.auth.signInWithPassword({ phone: '+66641545551', password });
  assert.equal(signed.error, null);
  const headers = { Authorization: `Bearer ${signed.data.session.access_token}`, 'Content-Type': 'application/json' };
  stage = 'send';
  const send = await fetch(`${base}/api/auth/sms`, { method: 'POST', headers, body: JSON.stringify({ action: 'send' }) });
  console.log(`SEND_HTTP_STATUS=${send.status}`);
  assert.equal(send.status, 200, 'Send endpoint did not accept the challenge');
  const challenge = await send.json();
  assert.equal(typeof challenge.challengeId, 'string');
  console.log('SMS_SENT: enter the received six-digit code within five minutes.');
  stage = 'handset-code';
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  input = createInterface({ input: process.stdin, terminal: false });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Handset acceptance expired')), 300_000);
    input.once('line', line => { clearTimeout(timer); resolve(line.trim()); });
    input.once('close', () => { clearTimeout(timer); reject(new Error('Input closed')); });
  });
  assert.match(code, /^[0-9]{6}$/, 'Code must contain six digits');
  const body = JSON.stringify({ action: 'verify', challengeId: challenge.challengeId, code });
  stage = 'verify';
  const verified = await fetch(`${base}/api/auth/sms`, { method: 'POST', headers, body });
  assert.equal(verified.status, 200, 'Received code was not accepted');
  assert.equal((await auth.rpc('sms_login_status')).data.status, 'READY');
  const replay = await fetch(`${base}/api/auth/sms`, { method: 'POST', headers, body });
  assert.notEqual(replay.status, 200, 'Used code must not verify again');
  console.log('HANDSET_ACCEPTANCE_PASSED: received code verified; replay rejected.');
} catch {
  console.error(`HANDSET_ACCEPTANCE_FAILED at ${stage}: no code or credentials logged.`);
  process.exitCode = 1;
} finally {
  input?.close();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  await auth.auth.signOut({ scope: 'local' });
  if (user) {
    await admin.from('profiles').delete().eq('id', user);
    await admin.auth.admin.deleteUser(user);
  }
}
