// main.ts — the program the make.fun harness runs: `node /bot/main.ts`
// (Node 22, no dependencies, nothing installed, no network).
//
// It answers every case found in the input directory with solve.js and
// writes each answer — the output tree as a JSON object of path -> text —
// to the output directory.
//
// Environment (as the grader sets it):
//   MAKEFUN_BOT_DIR    the entry's repository, read-only   (default /bot)
//   MAKEFUN_INPUT_DIR  the drawn instance's input, read-only (default /input)
//   MAKEFUN_OUTPUT_DIR an empty writable directory          (default /output)
//
// Input layouts accepted (the kit's starter pins the exact one; this
// adapter covers the plausible shapes so the protocol lives in one place):
//   - one or more *.json files in the input dir, each either a single
//     case { site, templates, files } or { "cases": [ <case>, ... ] }
//   - otherwise, a site tree: site.json + templates/ + files/ directories
//   - otherwise, one JSON document on stdin (a case, or { cases: [...] })
// Answers: <output>/<case-name>.answer.json per case, plus
// <output>/answer.json when there is exactly one case.
//
// NOTE: written in the JavaScript subset of TypeScript so Node 22's type
// stripping runs it as-is.

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './solve.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

function collectCases() {
  const cases = []; // [{ name, input }]
  if (existsSync(inputDir) && statSync(inputDir).isDirectory()) {
    const names = readdirSync(inputDir).sort();
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const doc = JSON.parse(readFileSync(join(inputDir, name), 'utf8'));
      const base = name.slice(0, -5);
      if (doc && Array.isArray(doc.cases)) {
        doc.cases.forEach((c, i) => cases.push({ name: base + '-' + i, input: c }));
      } else {
        cases.push({ name: base, input: doc });
      }
    }
    if (cases.length) return cases;
    // Site-tree layout: site.json + templates/ + files/
    const sitePath = join(inputDir, 'site.json');
    if (existsSync(sitePath)) {
      const readTree = (dir) => {
        const obj = {};
        if (!existsSync(dir)) return obj;
        const walk = (d, prefix) => {
          for (const e of readdirSync(d).sort()) {
            const p = join(d, e);
            if (statSync(p).isDirectory()) walk(p, prefix + e + '/');
            else obj[prefix + e] = readFileSync(p, 'utf8');
          }
        };
        walk(dir, '');
        return obj;
      };
      cases.push({
        name: 'answer',
        input: {
          site: JSON.parse(readFileSync(sitePath, 'utf8')),
          templates: readTree(join(inputDir, 'templates')),
          files: readTree(join(inputDir, 'files')),
        },
      });
      return cases;
    }
  }
  return cases;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const cases = collectCases();
if (!cases.length && !process.stdin.isTTY) {
  const text = await readStdin();
  if (text.trim()) {
    const doc = JSON.parse(text);
    if (doc && Array.isArray(doc.cases)) {
      doc.cases.forEach((c, i) => cases.push({ name: 'case-' + i, input: c }));
    } else {
      cases.push({ name: 'answer', input: doc });
    }
  }
}

const answers = cases.map(({ name, input }) => ({ name, answer: run(input) }));
for (const { name, answer } of answers) {
  writeFileSync(join(outputDir, name + '.answer.json'), JSON.stringify(answer));
}
if (answers.length === 1) {
  writeFileSync(join(outputDir, 'answer.json'), JSON.stringify(answers[0].answer));
}
