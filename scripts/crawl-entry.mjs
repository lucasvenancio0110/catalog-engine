import { spawn } from 'node:child_process';
import { resolveYupooSourceUrl } from './yupoo-source-resolver.mjs';

const requestedSource = process.argv[2] || 'https://zhouchangliang.x.yupoo.com/albums/';
const resolvedSource = await resolveYupooSourceUrl(requestedSource);

if (resolvedSource !== requestedSource) {
  console.log(`Rota Yupoo resolvida automaticamente: ${new URL(resolvedSource).pathname} (subcategoria).`);
}

const child = spawn(process.execPath, ['scripts/crawl-yupoo.mjs', resolvedSource], {
  stdio: 'inherit',
  env: process.env
});

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Crawler interrompido por sinal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
