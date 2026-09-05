// Serve Next's actual standalone production build with its public/static assets.
import { cp, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import 'dotenv/config';
try {
  await access('.next/standalone/server.js');
  await cp('.next/static', '.next/standalone/.next/static', { recursive: true });
  await cp('public', '.next/standalone/public', { recursive: true });
  await cp('docs', '.next/standalone/docs', { recursive: true });
} catch {
  console.error('Production build is missing. Run npm run build before npm start.');
  process.exit(1);
}
const server = spawn(process.execPath, ['.next/standalone/server.js'], { stdio: 'inherit', env: { ...process.env, HOSTNAME: '0.0.0.0', PORT: process.env.PORT || '3000', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' } });
server.on('error', error => { console.error(error.message); process.exit(1); });
server.on('exit', code => process.exit(code || 0));
process.on('SIGTERM', () => server.kill('SIGTERM'));
process.on('SIGINT', () => server.kill('SIGINT'));
