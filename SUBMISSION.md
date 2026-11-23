# SUBMISSION — "Build a static site faster, 22 November 2026"

Bounty: https://make.fun/bounty/site-generator-speed-01-run-20261122
Slug: `site-generator-speed-01-run-20261122` · Prize: $100 USDC in escrow,
10 places × $10 · **Entries close 2026-11-24T20:00:00Z (25 Nov 04:00 WITA)** ·
Final set drawn from drand round **34249212** · Result due 2026-12-09T20:00Z.
Status when checked (2026-11-23 ~15:10 UTC): 8,323 submissions already in.

## Exact spec (from the bounty page + the public requirements API)

**Task.** Write a faster drop-in for make.fun's own **makefun-site 1.0.0**
(its reference program) that answers *exactly* as it does on every case.
For each case, the answer is the output tree that makefun-site 1.0.0's
`build` returns for the case's site, **as a JSON object of every path it
writes** (each page's `index.html`, the index and tag pages,
`build-report.txt`, and each static file) **and that file's text, byte for
byte**.

**Input.** One case = one generated site `{ site, templates, files }`:
200–600 Markdown sources, a few static files, 14–30 templates. A set
holds **3 cases**, each drawn from a public drand round by the published
generator. Practice set: drawn from a round emitted before the competition
opened, published in the kit. Final set: drand round 34249212.

**Entry shape.** `solve.js`, an ES module whose `run(input)` returns
makefun-site's answer for every input, and `main.ts`, the program the
harness runs, which answers every case with it. Each case is answered
alone — **nothing cached from one case to the next**.

**Runtime rules.**
- Node 22 runs `node /bot/main.ts`; JavaScript or TypeScript source only;
  nothing installed before the program runs; **no WebAssembly, native
  addon or prebuilt binary**.
- Grader sandbox: repo read-only at `/bot`, instance input read-only at
  `/input`, empty writable `/output`, 256 MB tmpfs at `/tmp`, no network,
  user 65534:65534, TZ=UTC, LANG=C.UTF-8, env `MAKEFUN_BOT_DIR=/bot`,
  `MAKEFUN_INPUT_DIR=/input`, `MAKEFUN_OUTPUT_DIR=/output`; **1 CPU,
  1024 MB RAM, 64 processes, 10 s wall time**; any exit code ≠ 0 fails.
- Determinism is checked: two runs on the same data must match.
- Whole repository ≤ **4 MiB** (`max_entry_bytes` 4194304).
- Scoring: an entry must answer every case exactly before its speed
  counts. Timing is **CPU time** (`cpu_us`, user+system, net of a null
  entry's median). Dev phase: 3 timed runs, median. Final: 1 warm-up +
  9 timed rounds, trimmed mean; the fastest **30** entries (contenders)
  go to the heat; finalists run 30 playoff rounds. **A reward needs CPU
  time faster than makefun-site 1.0.0, the house baseline, at 95%
  confidence (one-sided)** — merely placing in the top 10 is not enough
  if the baseline is not beaten.
- makefun-site's front matter, template dialect, Markdown subset, slug
  rule and report format are **its own** (not Hugo/Zola/Eleventy/
  metalsmith, and its Markdown is **not CommonMark**). They are stated in
  its README at `baseline/makefun-site/vendor/makefun-site/README.md`
  **inside the kit**, and its code is the reference wherever the two
  differ. A slug's Unicode normalisation is the sandbox Node 22's.

## What could NOT be obtained (unverified — read this before submitting)

- **makefun-site 1.0.0 is not an npm package and is not public on
  GitHub** (searched both). Its source, its README (the dialect spec),
  the practice set, the case generator and the kit's starter `main.ts`
  (which pins the exact input/output file protocol) exist **only inside
  the bounty kit**.
- The kit is served to accounts: getting it requires an API key, and an
  API key is minted from a signed Solana keypair (a wallet). Per the
  standing constraints for this build (no wallet creation, no make.fun
  skill installation, no submission), the kit was **not** downloaded.
- Therefore the following are **assumptions**, implemented cleanly in one
  place each so they can be corrected the moment the kit is available:
  1. Front-matter format: a leading `---` fence of `key: value` lines
     (`title`, `date`, `tags`, `slug`, `template`/`layout`, `draft`).
  2. Template dialect: `{{ var }}` (escaped), `{{{ var }}}` (raw),
     `{{#each}}…{{/each}}`, `{{#if}}…{{else}}…{{/if}}`, `{{> partial}}`,
     `{{! comment}}`, dotted lookups, `{{this}}` / `{{@index}}` in loops.
  3. Markdown subset: ATX headings, paragraphs, `**bold**`, `*italic*`,
     `` `code` ``, fenced code, links, images, `-`/`*` and `1.` lists,
     blockquotes, `---` rules; raw text HTML-escaped.
  4. Slug rule: NFKD-normalise, drop combining marks, lowercase,
     non-alphanumeric runs → `-`, trimmed.
  5. Page routing: page → `<slug>/index.html`; home → `index.html`;
     tag → `tags/<tag-slug>/index.html`; `draft: true` pages skipped;
     static files copied verbatim; `build-report.txt` = counts header
     plus sorted `path length` lines.
  6. Harness protocol in `main.ts`: cases arrive as JSON in
     `MAKEFUN_INPUT_DIR` (a case object, or `{cases: [...]}`), answers
     are written as `<name>.answer.json` (plus `answer.json` for a
     single case) into `MAKEFUN_OUTPUT_DIR`; a site-tree layout and
     stdin JSON are also accepted. The kit's starter defines the real
     layout — expect to adjust `collectCases()`/`main.ts` only.

## What was built (this directory)

- `solve.js` — the optimised engine: templates compiled once per run
  into node trees, a single-pass char-code Markdown scanner (no regex
  document splitting, no token tree), per-run slug memoisation, one-scan
  HTML escaping that copies clean runs in slices, array-join assembly.
  All caches live inside `run()` — nothing persists across cases.
- `main.ts` — the harness entrypoint described above (JavaScript subset
  of TypeScript, runs under Node 22 type stripping; no dependencies).
- `naive.js` — a deliberately straightforward implementation of the same
  assumed dialect (regex Markdown, string-replace templates), used only
  as the local reference for verification and timing.
- `gen.mjs` — seeded synthetic case generator (200/400/600 Markdown
  sources, 20 templates, 3 static files, Unicode titles/tags included).
- `bench.mjs` — verifies byte-identical output trees, then times both
  implementations with `process.cpuUsage()`.
- `LICENSE` (MIT), `README.md` (with the required make.fun badges —
  replace the `OWNER/REPO` placeholders before submitting),
  `package.json`.

## Benchmark results (local, honest)

Machine: this workspace VM (shared vCPU), **Node v24.22.1** — the
sandbox pins Node 22 on 1 CPU, so absolute numbers will differ there;
make.fun itself warns that local timings are only comparable against a
baseline measured on the same machine. The real makefun-site 1.0.0 could
not be measured (see above), so the comparison is against `naive.js`.

`node bench.mjs` — median CPU time (user+system) per case, outputs
verified **byte-identical** between the two implementations. Two full
runs on this shared VM (its CPU is shared, so run-to-run variance is
large — one 400-page reading even came out at parity):

| Case size | Output files | naive.js | solve.js | Speedup |
|---|---|---|---|---|
| 200 pages | 215 | 25.9 / 33.5 ms | 15.2 / 17.3 ms | 1.70× / 1.93× |
| 400 pages | 415 | 46.0 / 33.1 ms | 29.5 / 33.7 ms | 1.56× / 0.98× |
| 600 pages | 615 | 57.0 / 44.6 ms | 44.2 / 37.1 ms | 1.29× / 1.20× |

Summary: solve.js is consistently faster at 200 and 600 pages
(≈ 1.2–1.9×); at 400 pages the two are within noise of each other.
Steady-state warm runs at 600 pages measured ≈ 42.6 ms CPU/run.
End-to-end `main.ts` run verified locally (answer written, 23 paths for
a 12-page case), and determinism verified: two runs produced the same
SHA-256 for the answer file. Repository size ≈ 41 KB (cap 4 MiB).

Board context (public submissions list): dev-phase `cpu_us` scores seen
range from ≈ 700,000 µs (fastest seen) to ≈ 3,070,000 µs; winning
entries' titles describe the same techniques used here (compiled
templates, single-pass Markdown, cached slugify, bulk escaping) and
claim ≈ 2–4× over the house baseline on the practice set. Treat this
entry as a correct-shaped, fast starting point — **not** a verified
byte-exact drop-in — until it can be diffed against the kit's baseline
and practice set.

## Exact submission mechanism (do not run until the kit is checked)

An entry is a **public GitHub repository created after
2026-11-22T20:00:00Z**, at one commit, plus a signed entry message.
Required at the submitted commit: `main.ts` at the root, a `LICENSE`
file with an OSI-approved licence, a README carrying this bounty's three
live make.fun badges with the real owner/repo filled in, and the repo's
GitHub About set (website = the bounty page, topic `makefun`).
`.makefun/owner.json` (`{"wallet": "…"}`) is needed if the repo owner is
not the account's GitHub login. Transcripts/bundle are **optional** for
this competition (`bundle` deliverable: required = false).

Submit by POST `https://make.fun/api/competitions/site-generator-speed-01-run-20261122/submissions`
as `multipart/form-data` with fields `repo_url`, `commit_sha`, `bundle`,
`transcripts`, `title`, `entry_message`, `entry_signature`, authenticated
by `x-api-key` or a session cookie. `entry_message` is the template

```
make.fun entry v1
Domain: make.fun
Competition: site-generator-speed-01-run-20261122
Repo: {repo_url}
Commit: {commit_sha}
Transcripts: {transcripts_sha256}
Wallet: {wallet}
Nonce: {nonce}
Issued At: {issued_at}
```

(LF breaks, no trailing newline), signed with the account wallet's
Ed25519 key, signature in base58 as `entry_signature`, within 10 minutes
of signing. The account must hold a Solana wallet (the signing wallet is
the payout wallet). The kit CLI wraps all of this:
`node cli/makefun.mjs submit --competition site-generator-speed-01-run-20261122 --repo-url <url> --commit <sha> --title <title> --bundle <bundle> --keypair <file>`.
A no-GitHub alternative exists (source bundle: `repo_url` = `bundle:`,
a v2 git bundle whose history starts at the kit init's drand anchor).
Quotas: max 10 entries/day, 20 total, for this account's competition.

**Recommended next step before submitting:** obtain the kit (account +
keypair — a human decision), read
`baseline/makefun-site/vendor/makefun-site/README.md`, diff this
implementation against the real baseline on the practice set, fix the
six assumed points above, re-benchmark against the real baseline
locally, then submit.
