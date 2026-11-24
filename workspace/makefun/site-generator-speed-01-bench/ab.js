// ab.js — interleaved A/B bench: alternate fresh-process child runs of two
// solve dirs and compare PAIRED deltas, so slow VM drift cancels out.
// Usage: node ab.js <dirA> <dirB> [pairs=8] [mode=run|runm]
//   mode run  -> bench.js run  (per-case run() timing: runMs, cpuUs)
//   mode runm -> bench.js runm (real main.ts entry: cpuUs only)
// Prints per-pair runMs/cpuUs deltas (B-A) and summary stats.
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const BENCH = resolve(process.env.HOME, 'workspace/makefun/site-generator-speed-01-bench/bench.js');
const [dirA, dirB] = [resolve(process.argv[2]), resolve(process.argv[3])];
const pairs = Number(process.argv[4] ?? 8);
const mode = process.argv[5] ?? 'run';
if (!dirA || !dirB) { console.error('usage: node ab.js <dirA> <dirB> [pairs=8] [mode=run|runm]'); process.exit(2); }

function childRun(solveDir) {
  const outDir = join(process.cwd(), 'runs', `ab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const p = spawnSync(process.execPath, [BENCH, mode, solveDir, outDir], { encoding: 'utf8' });
  if (p.status !== 0) { console.error(`child FAILED for ${solveDir}:\n${p.stdout}\n${p.stderr}`); process.exit(1); }
  return JSON.parse(p.stdout.trim().split('\n').pop());
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { mean, med, min: s[0], max: s[s.length - 1] };
}

// 1 warm-up pair (discarded), then `pairs` measured pairs.
const rows = [];
for (let i = -1; i < pairs; i++) {
  const a = childRun(dirA);
  const b = childRun(dirB);
  if (a.sha256 !== b.sha256) { console.error(`SHA MISMATCH pair ${i}: A=${a.sha256} B=${b.sha256}`); process.exit(1); }
  const row = { pair: i, aRunMs: a.runMs, bRunMs: b.runMs, aCpu: a.cpuUs, bCpu: b.cpuUs, aWall: a.wallMs, bWall: b.wallMs, sha: a.sha256.slice(0, 12) };
  if (i >= 0) rows.push(row);
  console.log(`pair ${i}: A run=${a.runMs?.toFixed(1)}ms cpu=${a.cpuUs}us | B run=${b.runMs?.toFixed(1)}ms cpu=${b.cpuUs}us | dRun(B-A)=${a.runMs === undefined ? 'n/a' : (b.runMs - a.runMs).toFixed(1)}ms dCpu(B-A)=${b.cpuUs - a.cpuUs}us sha=${row.sha}`);
}

const dRun = rows.filter((r) => r.aRunMs !== undefined).map((r) => r.bRunMs - r.aRunMs);
const dCpu = rows.map((r) => r.bCpu - r.aCpu);
const aRun = stats(rows.filter((r) => r.aRunMs !== undefined).map((r) => r.aRunMs));
const bRun = stats(rows.filter((r) => r.bRunMs !== undefined).map((r) => r.bRunMs));
const aCpu = stats(rows.map((r) => r.aCpu));
const bCpu = stats(rows.map((r) => r.bCpu));
const wins = dRun.filter((d) => d > 0).length; // B slower than A => A wins on runMs
console.log(JSON.stringify({
  mode, pairs, dirA, dirB,
  runMs: { A: aRun, B: bRun, deltaBA: dRun.length ? stats(dRun) : null, aWins: wins, bWins: dRun.length - wins },
  cpuUs: { A: aCpu, B: bCpu, deltaBA: stats(dCpu), aWins: dCpu.filter((d) => d > 0).length },
  shaStable: new Set(rows.map((r) => r.sha)).size === 1, sha: rows[0].sha,
}, null, 1));
