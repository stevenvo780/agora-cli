import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(here, '..');
const cliPath = path.resolve(projectDir, 'src/index.mjs');

const runCli = (args, options = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: projectDir,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('exit', code => resolve({ code, stdout, stderr }));
});

test('help documenta login, clone y status', async () => {
  const result = await runCli(['help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /agora login/);
  assert.match(result.stdout, /agora clone <wsId>/);
  assert.match(result.stdout, /agora status \[dir\]/);
});

test('status no imprime tokens y detecta workspace git configurado', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'agora-cli-home-'));
  const repo = await mkdtemp(path.join(os.tmpdir(), 'agora-cli-repo-'));
  await writeFile(path.join(home, '.placeholder'), '');
  await new Promise((resolve, reject) => {
    const child = spawn('git', ['init'], { cwd: repo, stdio: 'ignore' });
    child.on('exit', code => code === 0 ? resolve(undefined) : reject(new Error(`git init ${code}`)));
  });
  await new Promise((resolve, reject) => {
    const child = spawn('git', ['config', 'agora.workspaceId', 'workspace-fixture'], { cwd: repo, stdio: 'ignore' });
    child.on('exit', code => code === 0 ? resolve(undefined) : reject(new Error(`git config ${code}`)));
  });

  const result = await runCli(['status', repo], { env: { HOME: home } });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Workspace: workspace-fixture/);
  assert.doesNotMatch(result.stdout, /token/i);
});

test('comando desconocido falla con ayuda accionable', async () => {
  const result = await runCli(['wat']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Comando desconocido/);
  assert.match(result.stderr, /agora help/);
});
