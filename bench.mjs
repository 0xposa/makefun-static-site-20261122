// bench.mjs — honest local benchmark.
// 1. Builds synthetic cases (200 / 400 / 600 Markdown sources).
// 2. Verifies solve.js and naive.js produce byte-identical output trees.
// 3. Times both with process.cpuUsage() (user+system) over repeated runs
//    and reports medians. Local numbers only: another machine, another
//    runtime build and the sandbox's Node 22 will read differently.

import { run as fastRun } from './solve.js';
import { run as naiveRun } from './naive.js';
import { makeCase } from './gen.mjs';

function sameTree(a, b) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return 'path count ' + ka.length + ' vs ' + kb.length;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return 'path mismatch: ' + ka[i] + ' vs ' + kb[i];
    if (a[ka[i]] !== b[ka[i]]) return 'content mismatch at ' + ka[i];
  }
  return null;
}

function timeCpu(fn, input, runs) {
  const times = [];
  for (let r = 0; r < runs; r++) {
    const start = process.cpuUsage();
    fn(input);
    const d = process.cpuUsage(start);
    times.push((d.user + d.system) / 1000); // ms
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

const sizes = [200, 400, 600];
console.log('node ' + process.version);
for (const size of sizes) {
  const input = makeCase(1234 + size, size);
  const fastOut = fastRun(input);
  const naiveOut = naiveRun(input);
  const diff = sameTree(fastOut, naiveOut);
  if (diff) {
    console.log(size + ' pages: OUTPUT MISMATCH — ' + diff);
    process.exitCode = 1;
    continue;
  }
  const runs = size >= 600 ? 5 : 7;
  const fastMs = timeCpu(fastRun, input, runs);
  const naiveMs = timeCpu(naiveRun, input, runs);
  console.log(
    size +
      ' pages: identical output (' +
      Object.keys(fastOut).length +
      ' files) | naive ' +
      naiveMs.toFixed(1) +
      ' ms CPU | solve ' +
      fastMs.toFixed(1) +
      ' ms CPU | speedup ' +
      (naiveMs / fastMs).toFixed(2) +
      'x'
  );
}
