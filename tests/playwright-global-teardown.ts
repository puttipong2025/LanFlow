import { execFileSync } from 'node:child_process';

function killWindowsListenersOnPort(port: number) {
  const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
  const pids = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;

    const [protocol, localAddress, , state, pid] = parts;
    if (
      protocol.toLowerCase() === 'tcp' &&
      localAddress.endsWith(`:${port}`) &&
      state.toUpperCase() === 'LISTENING' &&
      /^\d+$/.test(pid)
    ) {
      pids.add(pid);
    }
  }

  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      // The server may already be exiting by the time teardown reaches it.
    }
  }
}

export default async function globalTeardown() {
  if (process.platform !== 'win32') return;

  killWindowsListenersOnPort(process.env.PW_PROJECT === 'pwa' ? 3001 : 3000);
}
