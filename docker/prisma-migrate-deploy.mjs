#!/usr/bin/env node
// prisma-migrate-deploy 1.0.0 (Black Shard eSign, BS-A670): `prisma migrate deploy`
// for Prisma 6.19.x with no database URL on any command line.
//
// WHY. auditd on the host records the argv of every execve. `npx prisma migrate
// deploy` (Prisma 6.19.3) first starts
//     schema-engine cli --datasource <URL> can-connect-to-database
// so every container start wrote the esign database password into the host audit
// log and the SIEM archive (leak check family E, 27 Sep 2026). No flag or variable
// turns that call off.
//
// WHAT. The CLI does the migration itself by starting the same engine as a JSON-RPC
// server, `schema-engine --datamodels <schema.prisma>`, which reads the URL from its
// own environment through the schema's url = env("...") and directUrl = env("..."),
// and sending it one request. This script sends that request and nothing else, read
// from the Prisma 6.19.3 CLI build (MigrateDeploy -> Migrate.applyMigrations):
//
//     applyMigrations {
//       migrationsList: { baseDir, lockfile: {path, content},
//                         migrationDirectories: [{path, migrationFile: {path,
//                           content: {tag: "ok"|"error", value}}}],
//                         shadowDbInitScript: "" },
//       filters: { externalTables: [], externalEnums: [] } }
//
// Prisma 5.x passed a directory path instead (migrationsDirectoryPath), so this
// refuses any Prisma other than 6.19.x and any engine binary whose commit is not
// the one @prisma/engines-version names. Moving the pin means re-reading the CLI
// build and re-measuring argv (docker/prisma-migrate-deploy.test.sh).
//
// Skipped from the CLI: the can-connect-to-database / create-database check (the
// leak itself; a missing database fails the request with P1003 instead) and the
// telemetry and update checks. The schema's url and directUrl variables must be
// in the environment (docker-compose sets both); they are never arguments.
//
// USE (from /app/apps/remix, as start.sh does):
//   node prisma-migrate-deploy.mjs --schema ../../packages/prisma/schema.prisma
// Exit 0 applied or nothing to apply, 1 the engine refused or failed, 2 a
// precondition failed.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '1.0.0';
export const PINNED_PRISMA_MINOR = '6.19.';
const TAG = 'prisma-migrate-deploy';

export class Refusal extends Error {}

/** Parse argv; only --schema. Never echoes an argument: the likeliest stray one is a URL. */
export function parseArgs(argv) {
  const o = { schema: '../../packages/prisma/schema.prisma' };
  if (argv.some((a) => String(a).includes('://'))) {
    throw new Refusal('an argument holds a URL (not shown); the database URL comes from the environment only');
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version') return { version: true };
    if (a === '--schema') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Refusal('--schema needs a value');
      o.schema = v;
      i++;
    } else if (a.startsWith('--schema=')) {
      o.schema = a.slice(9);
    } else {
      throw new Refusal('unknown argument (not shown); usage: node prisma-migrate-deploy.mjs [--schema <path>]');
    }
  }
  return o;
}

/** The env var names the datasource reads: {url, directUrl} (directUrl may be ''). */
export function datasourceEnvNames(schemaText) {
  const block = /datasource\s+\w+\s*\{([\s\S]*?)\}/.exec(schemaText);
  if (!block) throw new Refusal('no datasource block in the schema');
  const read = (key) => {
    const line = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm').exec(block[1]);
    if (!line) return '';
    const m = /^env\(\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\)/.exec(line[1].trim());
    if (!m) throw new Refusal(`the datasource ${key} is not env("NAME"); a literal URL in the schema is not supported`);
    return m[1];
  };
  const url = read('url');
  if (!url) throw new Refusal('the datasource has no url');
  return { url, directUrl: read('directUrl') };
}

/** Every form of a secret that could surface in engine output: each URL, raw and decoded password. */
export function secretForms(urls) {
  const forms = new Set();
  for (const url of urls) {
    if (!url) continue;
    forms.add(url);
    const m = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@]*?:([^/@]*)@/.exec(url);
    if (m && m[1]) {
      forms.add(m[1]);
      try {
        forms.add(decodeURIComponent(m[1]));
      } catch {
        /* not percent-encoded */
      }
    }
  }
  return [...forms].filter((f) => f && f.length >= 4).sort((a, b) => b.length - a.length);
}

export function makeScrub(forms) {
  return (s) => {
    let t = String(s);
    for (const f of forms) t = t.split(f).join('<REDACTED>');
    return t;
  };
}

/** Where the URL points, without user or password. */
export function describeTarget(url) {
  try {
    const u = new URL(url);
    const db = decodeURIComponent(u.pathname.replace(/^\//, '')) || '(default)';
    return `${u.protocol.replace(/:$/, '')} database "${db}" at ${u.hostname}${u.port ? ':' + u.port : ''}`;
  } catch {
    return 'a datasource whose URL does not parse (not shown)';
  }
}

/** The Prisma version reachable from `fromDir` and its schema engine binary, checked. */
export function resolveEngine(fromDir, env) {
  const req = createRequire(path.join(path.resolve(fromDir), 'noop.js'));
  let prismaPkg;
  try {
    prismaPkg = req.resolve('prisma/package.json');
  } catch {
    throw new Refusal(`prisma is not installed where ${fromDir} can reach it`);
  }
  const version = JSON.parse(fs.readFileSync(prismaPkg, 'utf8')).version;
  if (!version.startsWith(PINNED_PRISMA_MINOR)) {
    throw new Refusal(
      `prisma ${version} is not ${PINNED_PRISMA_MINOR}x, the version this script's RPC was read from. ` +
        'Re-read the CLI build and re-measure argv before moving PINNED_PRISMA_MINOR.',
    );
  }
  const enginesPkgPath = createRequire(prismaPkg).resolve('@prisma/engines/package.json');
  const enginesPkg = JSON.parse(fs.readFileSync(enginesPkgPath, 'utf8'));
  const commit = String((enginesPkg.dependencies || {})['@prisma/engines-version'] || '').split('.').pop();
  let binary = env.PRISMA_SCHEMA_ENGINE_BINARY || '';
  if (!binary) {
    const dir = path.dirname(enginesPkgPath);
    const found = fs
      .readdirSync(dir)
      .filter((f) => /^schema-engine-[a-z0-9._-]+$/.test(f) && !/\.(js|ts|map|node)$/.test(f))
      .map((f) => path.join(dir, f));
    if (found.length !== 1) {
      throw new Refusal(`expected one schema engine binary in ${dir}, found ${found.length}; set PRISMA_SCHEMA_ENGINE_BINARY`);
    }
    binary = found[0];
  }
  const v = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 30000 });
  const got = ((v.stdout || '').trim().split(/\s+/).pop() || '').trim();
  if (v.status !== 0 || !commit || got !== commit) {
    throw new Refusal(`schema engine ${binary} reports commit '${got}', @prisma/engines-version names '${commit}'`);
  }
  return { version, binary, commit };
}

/** The migrationsList the Prisma 6.19.3 CLI builds (its function `sc`), byte for byte in shape. */
export function readMigrationsList(migrationsDir, shadowDbInitScript = '') {
  const lockPath = 'migration_lock.toml';
  let lockContent = null;
  try {
    lockContent = fs.readFileSync(path.join(migrationsDir, lockPath), 'utf8');
  } catch {
    lockContent = null;
  }
  let entries = [];
  try {
    entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const dirs = [];
  for (const e of entries.filter((x) => x.isDirectory())) {
    let content;
    try {
      content = { tag: 'ok', value: fs.readFileSync(path.join(migrationsDir, e.name, 'migration.sql'), 'utf8') };
    } catch (err) {
      content = { tag: 'error', value: err.message };
    }
    dirs.push({ path: e.name, migrationFile: { path: 'migration.sql', content } });
  }
  dirs.sort((a, b) => a.path.localeCompare(b.path));
  return {
    baseDir: migrationsDir,
    lockfile: { path: lockPath, content: lockContent },
    migrationDirectories: dirs,
    shadowDbInitScript,
  };
}

/**
 * One engine as a JSON-RPC server: argv is `--datamodels <schema>` and nothing else,
 * the URL travels only in `env`, as the CLI starts it.
 */
export function startEngine({ binary, schemaPath, env, scrub, out = process.stdout, timeoutMs = 600000 }) {
  const { PWD: _pwd, ...rest } = env;
  const child = spawn(binary, ['--datamodels', schemaPath], {
    cwd: path.dirname(schemaPath),
    env: { RUST_LOG: 'info', RUST_BACKTRACE: '1', ...rest },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  const errors = [];
  let nextId = 1;
  let dead = null;
  let outBuf = '';
  let errBuf = '';
  const failAll = (e) => {
    dead = dead || e;
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    pending.clear();
  };
  child.on('error', (e) => failAll(new Error('schema engine did not start: ' + scrub(e.message))));
  child.on('exit', (code) => {
    const why = errors.length ? errors.join('; ') : `exit code ${code}`;
    failAll(new Error('the schema engine exited before answering: ' + scrub(why)));
  });
  child.stdin.on('error', () => {
    /* reported through exit */
  });
  child.stderr.on('data', (d) => {
    errBuf += d;
    let i;
    while ((i = errBuf.indexOf('\n')) >= 0) {
      const line = errBuf.slice(0, i);
      errBuf = errBuf.slice(i + 1);
      try {
        const j = JSON.parse(line);
        if (j.level === 'ERROR' && j.fields && j.fields.message) errors.push(scrub(j.fields.message));
      } catch {
        /* not a log line */
      }
    }
  });
  child.stdout.on('data', (d) => {
    outBuf += d;
    let i;
    while ((i = outBuf.indexOf('\n')) >= 0) {
      const line = outBuf.slice(0, i);
      outBuf = outBuf.slice(i + 1);
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.method === 'print' && msg.id !== undefined) {
        out.write(scrub(msg.params && msg.params.content) + '\n');
        child.stdin.write(JSON.stringify({ id: msg.id, jsonrpc: '2.0', result: {} }) + '\n');
        continue;
      }
      const p = pending.get(msg.id);
      if (!p || (msg.result === undefined && msg.error === undefined)) continue;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.result !== undefined) {
        p.resolve(msg.result);
      } else {
        const e = msg.error || {};
        const data = e.data || {};
        const code = data.error_code ? data.error_code + ': ' : '';
        p.reject(new Error(scrub(code + (data.message || e.message || JSON.stringify(e)))));
      }
    }
  });
  return {
    call(method, params) {
      if (dead) return Promise.reject(dead);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`the schema engine gave no answer to ${method} in ${timeoutMs / 1000} s`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, jsonrpc: '2.0', method, params }) + '\n');
      });
    },
    close() {
      try {
        child.stdin.end();
      } catch {
        /* already closed */
      }
      child.removeAllListeners('exit');
      child.kill();
    },
  };
}

export async function main(argv = process.argv.slice(2), env = process.env, out = process.stdout, err = process.stderr, deps = {}) {
  let scrub = (s) => String(s);
  let engine = null;
  try {
    const o = parseArgs(argv);
    if (o.version) {
      out.write(`${TAG} ${VERSION} (Prisma ${PINNED_PRISMA_MINOR}x)\n`);
      return 0;
    }
    const schemaPath = path.resolve(o.schema);
    if (!fs.statSync(schemaPath, { throwIfNoEntry: false })?.isFile()) throw new Refusal(`schema file not found: ${o.schema}`);
    const names = datasourceEnvNames(fs.readFileSync(schemaPath, 'utf8'));
    if (!env[names.url]) throw new Refusal(`${names.url} is not set in the environment`);
    if (names.directUrl && !env[names.directUrl]) throw new Refusal(`${names.directUrl} is not set in the environment`);
    scrub = makeScrub(secretForms([env[names.url], names.directUrl ? env[names.directUrl] : '']));
    const eng = (deps.resolveEngine || resolveEngine)(process.cwd(), env);
    const migrationsDir = path.join(path.dirname(schemaPath), 'migrations');
    const list = readMigrationsList(migrationsDir);
    const target = describeTarget(names.directUrl ? env[names.directUrl] : env[names.url]);
    out.write(
      `${TAG} ${VERSION}: prisma ${eng.version}, ${list.migrationDirectories.length} migrations, ` +
        `${names.directUrl || names.url} from the environment: ${target}\n`,
    );
    engine = (deps.startEngine || startEngine)({ binary: eng.binary, schemaPath, env, scrub, out });
    const r = await engine.call('applyMigrations', {
      migrationsList: list,
      filters: { externalTables: [], externalEnums: [] },
    });
    const applied = (r && r.appliedMigrationNames) || [];
    out.write(applied.length ? `${TAG}: applied ${applied.length}: ${applied.join(', ')}\n` : `${TAG}: No pending migrations to apply.\n`);
    return 0;
  } catch (e) {
    err.write(`${TAG}: ${scrub(e && e.message)}\n`);
    return e instanceof Refusal ? 2 : 1;
  } finally {
    if (engine) engine.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then((code) => process.exit(code));
}
