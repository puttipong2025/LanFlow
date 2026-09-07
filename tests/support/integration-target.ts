const LOCAL_SUPABASE_HOSTS = new Set(['127.0.0.1', 'localhost']);

export const LOCAL_SUPABASE_API_URL = 'http://127.0.0.1:55421';

export function assertSafeIntegrationTarget(rawUrl: string): URL {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid Supabase integration URL: ${rawUrl}`);
  }

  if (
    target.protocol !== 'http:' ||
    !LOCAL_SUPABASE_HOSTS.has(target.hostname) ||
    target.port !== '55421'
  ) {
    throw new Error(
      `Integration tests may only mutate the local Supabase API at ${LOCAL_SUPABASE_API_URL}`,
    );
  }

  return target;
}
