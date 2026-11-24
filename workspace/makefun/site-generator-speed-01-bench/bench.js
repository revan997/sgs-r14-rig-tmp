// bench.js — measurement rig for site-generator-speed-01-run-20261122.
// Lives OUTSIDE the repo (never committed). Mirrors main.ts: read cases.json,
// run() per case in one process, JSON.stringify(answers), write answers.json.
// Modes:
//   node bench.js run <solveDir> <outDir> [tag]   — one child run; prints one JSON line
//   node bench.js bench <solveDir> [rounds]       — 1 warm-up + N fresh-process rounds,
//                                                   trimmed mean (drop 2 low + 2 high)
//   node bench.js goldens <solveDir> <goldenDir>  — freeze current outputs as goldens
//   node bench.js verify <solveDir> <goldenDir>   — one run, SHA-256 vs goldens
//   node bench.js score <outDir>                  — run kit scorer on an answers.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setFlagsFromString } from 'node:v8';

const KIT = resolve(process.env.HOME, 'workspace/makefun/kits-20261123/site-generator-speed-01-run-20261122-kit/site-generator-speed-01-run-20261122-kit');
const CASES = join(KIT, 'practice/input/cases.json');
const SCORER = join(KIT, 'program/scorer/main.ts');
const REFERENCE = join(KIT, 'practice/reference');

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

async function childRun(solveDir, outDir) {
  setFlagsFromString('--no-incremental-marking');
  const t0 = process.hrtime.bigint();
  const cpu0 = process.cpuUsage();
  const cases = JSON.parse(readFileSync(CASES, 'utf8'));
  const tParse = process.hrtime.bigint();
  const { run } = await import(pathToFileURL(join(resolve(solveDir), 'solve.js')).href);
  const tImport = process.hrtime.bigint();
  const answers = [];
  const perCase = [];
  for (const c of cases) {
    const c0 = process.cpuUsage();
    const s0 = process.hrtime.bigint();
    answers.push(run(c.input));
    const s1 = process.hrtime.bigint();
    const c1 = process.cpuUsage(c0);
    perCase.push({ id: c.id, wallMs: Number(s1 - s0) / 1e6, cpuUs: c1.user + c1.system });
  }
  const tRun = process.hrtime.bigint();
  const json = JSON.stringify(answers);
  const tStr = process.hrtime.bigint();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'answers.json'), json);
  const t1 = process.hrtime.bigint();
  const cpu1 = process.cpuUsage(cpu0);
  const result = {
    solveDir: resolve(solveDir),
    cpuUs: cpu1.user + cpu1.system,
    wallMs: Number(t1 - t0) / 1e6,
    parseMs: Number(tParse - t0) / 1e6,
    importMs: Number(tImport - tParse) / 1e6,
    runMs: Number(tRun - tImport) / 1e6,
    stringifyMs: Number(tStr - tRun) / 1e6,
    writeMs: Number(t1 - tStr) / 1e6,
    bytes: Buffer.byteLength(json),
    sha256: sha256(json),
    perCase,
  };
  console.log(JSON.stringify(result));
}

function trimmedMean(values) {
  const s = [...values].sort((a, b) => a - b);
  const kept = s.length >= 5 ? s.slice(2, -2) : s;
  return { sorted: s, kept, mean: kept.reduce((a, b) => a + b, 0) / kept.length };
}

async function childRunMain(solveDir, outDir) {
  // Exercise the REAL main.ts (the graded entry point), not a replica of it.
  process.env.MAKEFUN_INPUT_DIR = join(KIT, 'practice/input');
  process.env.MAKEFUN_OUTPUT_DIR = outDir;
  mkdirSync(outDir, { recursive: true }); // main.ts writes into it; the harness provides /output
  const t0 = process.hrtime.bigint();
  const cpu0 = process.cpuUsage();
  await import(pathToFileURL(join(resolve(solveDir), 'main.ts')).href);
  const t1 = process.hrtime.bigint();
  const cpu1 = process.cpuUsage(cpu0);
  const json = readFileSync(join(outDir, 'answers.json'), 'utf8');
  console.log(JSON.stringify({
    solveDir: resolve(solveDir),
    cpuUs: cpu1.user + cpu1.system,
    wallMs: Number(t1 - t0) / 1e6,
    bytes: Buffer.byteLength(json),
    sha256: sha256(json),
  }));
}

function bench(solveDir, rounds = 9, childMode = 'run') {
  const outBase = resolve('runs');
  const results = [];
  const total = 1 + rounds;
  for (let r = 0; r < total; r++) {
    const outDir = join(outBase, `bench-${Date.now()}-${r}`);
    const p = spawnSync(process.execPath, [process.argv[1], childMode, solveDir, outDir], { encoding: 'utf8' });
    if (p.status !== 0) {
      console.error(`round ${r} FAILED:\n${p.stdout}\n${p.stderr}`);
      process.exit(1);
    }
    const res = JSON.parse(p.stdout.trim().split('\n').pop());
    res.round = r === 0 ? 'warmup' : r;
    results.push(res);
    console.log(`round ${res.round}: cpu=${res.cpuUs}us wall=${res.wallMs.toFixed(1)}ms${res.runMs === undefined ? '' : ` run=${res.runMs.toFixed(1)}ms stringify=${res.stringifyMs.toFixed(1)}ms`} sha=${res.sha256.slice(0, 12)}`);
  }
  const timed = results.slice(1);
  const cpu = trimmedMean(timed.map((x) => x.cpuUs));
  const wall = timed.map((x) => x.wallMs).sort((a, b) => a - b);
  const run = timed[0].runMs === undefined ? null : trimmedMean(timed.map((x) => x.runMs));
  const str = timed[0].stringifyMs === undefined ? null : trimmedMean(timed.map((x) => x.stringifyMs));
  const shas = new Set(timed.map((x) => x.sha256));
  console.log(JSON.stringify({
    solveDir: resolve(solveDir), rounds,
    cpuTrimmedMeanUs: cpu.mean, cpuKept: cpu.kept, cpuSorted: cpu.sorted,
    wallMedianMs: wall[Math.floor(wall.length / 2)], wallSortedMs: wall,
    runTrimmedMeanMs: run === null ? undefined : run.mean, stringifyTrimmedMeanMs: str === null ? undefined : str.mean,
    shaStableAcrossRounds: shas.size === 1, sha: timed[0].sha256,
    perCaseCpuUs: timed[0].perCase,
  }, null, 1));
}

const mode = process.argv[2];
if (mode === 'run') {
  await childRun(process.argv[3], process.argv[4]);
} else if (mode === 'runm') {
  await childRunMain(process.argv[3], process.argv[4]);
} else if (mode === 'bench') {
  bench(process.argv[3], Number(process.argv[4] ?? 9), 'run');
} else if (mode === 'benchm') {
  bench(process.argv[3], Number(process.argv[4] ?? 9), 'runm');
} else if (mode === 'goldens') {
  const solveDir = process.argv[3], goldenDir = resolve(process.argv[4]);
  const outDir = join(goldenDir, 'out');
  const p = spawnSync(process.execPath, [process.argv[1], 'run', solveDir, outDir], { encoding: 'utf8' });
  if (p.status !== 0) { console.error(p.stdout, p.stderr); process.exit(1); }
  const res = JSON.parse(p.stdout.trim().split('\n').pop());
  mkdirSync(goldenDir, { recursive: true });
  writeFileSync(join(goldenDir, 'answers.json'), readFileSync(join(outDir, 'answers.json'), 'utf8'));
  writeFileSync(join(goldenDir, 'meta.json'), JSON.stringify({ solveDir: resolve(solveDir), sha256: res.sha256, bytes: res.bytes, cpuUs: res.cpuUs, wallMs: res.wallMs }, null, 1));
  console.log(`goldens frozen: sha=${res.sha256} bytes=${res.bytes}`);
} else if (mode === 'verify') {
  const solveDir = process.argv[3], goldenDir = resolve(process.argv[4]);
  const golden = JSON.parse(readFileSync(join(goldenDir, 'meta.json'), 'utf8'));
  const outDir = join(goldenDir, 'verify-out');
  const p = spawnSync(process.execPath, [process.argv[1], 'run', solveDir, outDir], { encoding: 'utf8' });
  if (p.status !== 0) { console.error(p.stdout, p.stderr); process.exit(1); }
  const res = JSON.parse(p.stdout.trim().split('\n').pop());
  const ok = res.sha256 === golden.sha256;
  console.log(`verify: ${ok ? 'MATCH' : 'MISMATCH'} sha=${res.sha256} golden=${golden.sha256} cpu=${res.cpuUs}us wall=${res.wallMs.toFixed(1)}ms`);
  process.exit(ok ? 0 : 1);
} else if (mode === 'score') {
  const outDir = resolve(process.argv[3]);
  const scoresDir = join(outDir, 'scores');
  mkdirSync(scoresDir, { recursive: true });
  const p = spawnSync(process.execPath, [SCORER], {
    encoding: 'utf8',
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: outDir, MAKEFUN_REFERENCE_DIR: REFERENCE, MAKEFUN_SCORES_DIR: scoresDir },
  });
  console.log(p.stdout, p.stderr);
  if (existsSync(join(scoresDir, 'scores.json'))) console.log(readFileSync(join(scoresDir, 'scores.json'), 'utf8'));
  process.exit(p.status ?? 0);
} else {
  console.error('usage: bench.js run|bench|goldens|verify|score ...');
  process.exit(2);
}
