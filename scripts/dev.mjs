import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import 'dotenv/config';
process.env.NEXT_TELEMETRY_DISABLED ||= '1';
const python = existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python';
const children = [
  spawn(python, ['-m', 'uvicorn', 'ml.service:app', '--host', '0.0.0.0', '--port', '8000'], { stdio: 'inherit' }),
  spawn('node', ['--import', 'tsx', 'server/src/index.ts'], { stdio: 'inherit' }),
  spawn('node', ['node_modules/next/dist/bin/next', 'dev', '--hostname', '0.0.0.0', '--port', '3000'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach(child => child.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 1500).unref();
}
children.forEach(child => { child.on('error', error => { console.error(error); stop(1); }); child.on('exit', code => { if (!stopping) stop(code || 0); }); });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
