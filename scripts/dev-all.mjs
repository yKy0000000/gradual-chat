import { spawn, spawnSync } from "node:child_process";

const npmCliPath = process.env.npm_execpath;

if (!npmCliPath) {
  throw new Error("Run this script through npm: npm run dev:all");
}

const processes = [
  start("frontend", "dev:frontend"),
  start("backend", "dev:server"),
];
let isStopping = false;

function start(name, script) {
  const child = spawn(process.execPath, [npmCliPath, "run", script], {
    detached: process.platform !== "win32",
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (isStopping) {
      return;
    }

    isStopping = true;
    stopAll(signal ?? "SIGTERM", child);
    process.exitCode = code ?? 1;
    console.error(`${name} stopped; shutting down the development processes.`);
  });

  return child;
}

function stopAll(signal, exitedProcess) {
  for (const child of processes) {
    if (child !== exitedProcess && child.exitCode === null) {
      stopProcessTree(child, signal);
    }
  }
}

function stopProcessTree(child, signal) {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    // The process may already have exited between the status check and signal.
  }
}

function handleSignal(signal) {
  if (isStopping) {
    return;
  }

  isStopping = true;
  stopAll(signal);
}

process.on("SIGINT", () => handleSignal("SIGINT"));
process.on("SIGTERM", () => handleSignal("SIGTERM"));
