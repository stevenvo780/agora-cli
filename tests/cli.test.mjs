import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(here, '..');
const cliPath = path.resolve(projectDir, 'src/index.mjs');

const runCli = (args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: projectDir,
    env: { ...(options.inheritEnv === false ? {} : process.env), ...(options.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', reject);
  child.on('close', code => resolve({ code, stdout, stderr }));
});

const runGit = (cwd, args, env) => new Promise((resolve, reject) => {
  const child = spawn('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `git exited with ${code}`)));
});

const pushFixture = async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agora-cli-push-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const repo = path.join(root, 'workspace');
  const remote = path.join(root, 'remote.git');
  await mkdir(home);
  await mkdir(repo);
  const env = {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0'
  };
  const git = (...args) => runGit(repo, args, env);
  const remoteGit = (...args) => runGit(root, ['--git-dir', remote, ...args], env);
  await runGit(root, ['init', '--bare', '-b', 'main', remote], env);
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Agora CLI Test');
  await git('config', 'user.email', 'agora-cli-test@example.invalid');
  await writeFile(path.join(repo, 'file.txt'), 'initial\n');
  await git('add', '-A');
  await git('commit', '-m', 'initial');
  await git('remote', 'add', 'origin', remote);
  await git('push', '-u', 'origin', 'main');
  // Pass only synthetic configuration to the CLI and its Git subprocesses.
  const push = (...args) => runCli(['push', repo, ...args], { env, inheritEnv: false });
  return { root, repo, git, remoteGit, push };
};

test('push publica commits del IDE con índice limpio sin crear otro commit', async (t) => {
  const { repo, git, remoteGit, push } = await pushFixture(t);
  await writeFile(path.join(repo, 'file.txt'), 'committed in IDE\n');
  await git('add', '-A');
  await git('commit', '-m', 'IDE commit');
  const head = await git('rev-parse', 'HEAD');
  assert.equal(await git('status', '--porcelain'), '');
  assert.notEqual(await remoteGit('rev-parse', 'main'), head);

  const result = await push('-m', 'must not create an empty commit');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await remoteGit('rev-parse', 'main'), head);
  assert.equal(await git('rev-parse', 'HEAD'), head);
  assert.equal(await git('rev-list', '--count', 'HEAD'), '2');
});

test('push reintenta un push rechazado sin duplicar el commit ya creado', async (t) => {
  const { repo, git, remoteGit, push } = await pushFixture(t);
  const original = await remoteGit('rev-parse', 'main');
  await remoteGit('config', 'receive.hideRefs', 'refs/heads/main');
  await writeFile(path.join(repo, 'file.txt'), 'pending upload\n');

  const failed = await push('-m', 'commit before rejected push');

  assert.equal(failed.code, 1, failed.stderr);
  const committed = await git('rev-parse', 'HEAD');
  assert.notEqual(committed, original);
  assert.equal(await remoteGit('rev-parse', 'main'), original);
  assert.equal(await git('status', '--porcelain'), '');
  await remoteGit('config', '--unset', 'receive.hideRefs');

  const retried = await push('-m', 'must not duplicate the commit');

  assert.equal(retried.code, 0, retried.stderr);
  assert.equal(await remoteGit('rev-parse', 'main'), committed);
  assert.equal(await git('rev-parse', 'HEAD'), committed);
  assert.equal(await git('rev-list', '--count', 'HEAD'), '2');
  assert.equal(await git('log', '-1', '--format=%s'), 'commit before rejected push');
});

test('push limpio y actualizado no crea un commit vacío', async (t) => {
  const { git, remoteGit, push } = await pushFixture(t);
  const head = await git('rev-parse', 'HEAD');

  const result = await push();

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await git('rev-parse', 'HEAD'), head);
  assert.equal(await remoteGit('rev-parse', 'main'), head);
  assert.equal(await git('rev-list', '--count', 'HEAD'), '1');
});

test('push limpio propaga el fallo del remoto y conserva HEAD', async (t) => {
  const { root, git, remoteGit, push } = await pushFixture(t);
  const head = await git('rev-parse', 'HEAD');
  await git('remote', 'set-url', '--push', 'origin', path.join(root, 'missing.git'));

  const result = await push();

  assert.equal(result.code, 1, result.stderr);
  assert.equal(await git('rev-parse', 'HEAD'), head);
  assert.equal(await remoteGit('rev-parse', 'main'), head);
  assert.equal(await git('status', '--porcelain'), '');
});

test('push commitea archivos nuevos y eliminados con el mensaje indicado', async (t) => {
  const { repo, git, remoteGit, push } = await pushFixture(t);
  await rm(path.join(repo, 'file.txt'));
  await writeFile(path.join(repo, 'new.txt'), 'new file\n');

  const result = await push('-m', 'explicit message');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await git('log', '-1', '--format=%s'), 'explicit message');
  assert.equal(await git('rev-list', '--count', 'HEAD'), '2');
  assert.equal(await git('status', '--porcelain'), '');
  assert.equal(await remoteGit('rev-parse', 'main'), await git('rev-parse', 'HEAD'));
  assert.equal(await remoteGit('ls-tree', '--name-only', 'main'), 'new.txt');
  assert.equal(await remoteGit('show', 'main:new.txt'), 'new file');
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
