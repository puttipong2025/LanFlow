import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Next.js did not listen on port ${port} within ${timeoutMs} ms`);
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

let upstreamRequests = 0;
const upstreamSockets = new Set();
const unavailableAuth = http.createServer(() => {
  upstreamRequests += 1;
  // Deliberately never respond: this reproduces an unavailable Supabase Auth/API gateway.
});
unavailableAuth.on("connection", (socket) => {
  upstreamSockets.add(socket);
  socket.once("close", () => upstreamSockets.delete(socket));
});

const authPort = await listen(unavailableAuth);
const nextPort = await freePort();
const output = [];
const next = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-p", String(nextPort)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${authPort}`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "outage-test-key",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
next.stdout.on("data", (chunk) => output.push(chunk.toString()));
next.stderr.on("data", (chunk) => output.push(chunk.toString()));

try {
  await waitForPort(nextPort, 30_000);
  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${nextPort}/login`, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    throw new Error(
      `/login waited for unavailable Supabase instead of rendering; upstream requests: ${upstreamRequests}`,
      {
        cause,
      },
    );
  }
  const body = await response.text();
  const elapsedMs = Math.round(performance.now() - startedAt);

  assert.equal(response.status, 200, `/login returned HTTP ${response.status}`);
  assert.match(body, /LanFlow/, "/login response did not contain the login shell");
  assert.equal(
    upstreamRequests,
    0,
    `/login made ${upstreamRequests} request(s) to unavailable Supabase`,
  );
  console.log(`PASS /login rendered in ${elapsedMs} ms with zero Supabase requests`);
} catch (error) {
  const recentOutput = output.join("").slice(-4_000);
  if (recentOutput) console.error(recentOutput);
  throw error;
} finally {
  await stopProcess(next);
  for (const socket of upstreamSockets) socket.destroy();
  await new Promise((resolve) => unavailableAuth.close(resolve));
}
