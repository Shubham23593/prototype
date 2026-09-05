import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import 'dotenv/config';

process.env.NEXT_TELEMETRY_DISABLED ||= '1';
const frontendPort = process.env.PORT || '3000';
const apiPort = process.env.API_PORT || '4000';
const mlPort = process.env.ML_PORT || '8000';

function freePort(port) {
  if (process.platform !== 'win32') return;
  try {
    const stdout = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = stdout.split('\n');
    const myPid = process.pid;
    for (const line of lines) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid && pid !== myPid) {
          console.log(`[dev.mjs] Freeing occupied port ${port} (PID ${pid})...`);
          try {
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
          } catch {
            // Ignore if already terminated
          }
        }
      }
    }
  } catch {
    // Port not in use, continue
  }
}

// Ensure ports are free before starting
[frontendPort, apiPort, mlPort].forEach(freePort);

const python = existsSync('.venv/bin/python') ? '.venv/bin/python' : existsSync('.venv/Scripts/python.exe') ? '.venv/Scripts/python.exe' : 'python';

const children = [
  spawn(python, ['-u', '-m', 'uvicorn', 'ml.service:app', '--host', '0.0.0.0', '--port', mlPort, '--reload'], { stdio: ['ignore', 'inherit', 'inherit'] }),
  spawn('node', ['node_modules/tsx/dist/cli.mjs', 'watch', 'server/src/index.ts'], { stdio: 'inherit', env: { ...process.env, PORT: apiPort } }),
  spawn('node', ['node_modules/next/dist/bin/next', 'dev', '--hostname', '0.0.0.0', '--port', frontendPort], { stdio: 'inherit' }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach(child => {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
      } catch {
        child.kill('SIGTERM');
      }
    } else {
      child.kill('SIGTERM');
    }
  });
  setTimeout(() => process.exit(code), 1000).unref();
}

children.forEach(child => {
  child.on('error', error => {
    console.error('[dev.mjs] Child spawn error:', child.spawnargs, error);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    console.log('[dev.mjs] Child exit:', child.spawnargs, code, signal);
    if (!stopping && code !== 0) stop(code || 0);
  });
});

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

