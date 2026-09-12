import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

import {
  LOCAL_SUPABASE_API_URL,
  assertSafeIntegrationTarget,
} from './support/integration-target';

test('accepts the project local Supabase API target', () => {
  expect(assertSafeIntegrationTarget(LOCAL_SUPABASE_API_URL).origin).toBe(
    LOCAL_SUPABASE_API_URL,
  );
  expect(assertSafeIntegrationTarget('http://localhost:55421').port).toBe('55421');
});

test('rejects remote, encrypted, and wrong-port mutation targets', () => {
  for (const target of [
    'https://project.supabase.co',
    'https://127.0.0.1:55421',
    'http://127.0.0.1:54321',
    'not-a-url',
  ]) {
    expect(() => assertSafeIntegrationTarget(target), target).toThrow();
  }
});

test('Vercel CLI upload explicitly excludes local secrets, backups, and auth fixtures', () => {
  const rules = readFileSync('.vercelignore', 'utf8').split(/\r?\n/);
  for (const rule of [
    'output/',
    'supabase/cloud-backups/',
    'supabase/.temp/',
    '.env',
    '.env.*',
    'src/lib/server/*.json',
    'playwright/.auth/',
  ]) {
    expect(rules, rule).toContain(rule);
  }
  expect(rules.some((rule) => rule.startsWith('!'))).toBe(false);
});
