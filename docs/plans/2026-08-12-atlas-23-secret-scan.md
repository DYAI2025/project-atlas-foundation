> [!WARNING] **ARCHIVAL NOTICE — HISTORICAL / EXECUTED / NON-CANONICAL**
>
> This implementation plan has been **executed** for PR #16 (`ci/ATLAS-23-secret-scan`).
> It is retained only as historical execution evidence. It is **not** an active
> instruction or authorization source: none of the imperative instructions,
> sub-skill requirements, or execution authorizations below carry current authority.
> Current execution authority comes exclusively from the live Jira ATLAS-23 /
> Confluence / PO gates. The historical plan body below this notice is preserved
> unchanged.

---

# ATLAS-23 Secret-Scan Gate (SECRET_SCAN_ONLY) — Implementation Plan, Rev. 3

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, executed inside the
> repo-local `atlas-gated-pr` loop (`.claude/skills/atlas-gated-pr/SKILL.md`).
> Execution authorization: PO Execution Gate in Jira ATLAS-23 comment 12917.
> HARD LIMITS: no merge, no G2 artifact, no Jira/Confluence mutation, stop after the
> evidence packet.

**Goal:** Add a fail-closed, SHA-256-pinned Gitleaks 8.30.1 secret-scan gate covering the
full reachable git history (root commit, merge history, later-removed secrets) as dedicated
CI context `secret-scan`, plus local reproduction, without any new npm dependency.

**Architecture:** A zero-dependency Node wrapper (`scripts/secret-scan.mjs`) that
(0) digest-verifies the pinned release asset before executing it, (1) proves scanner
capability at runtime via a synthetic self-test repo (root-commit-only secret + evil-merge
secret + 4 detector vectors, final tree clean), (2) verifies the git scan surface is
complete and readable before scanning, (3) runs the history scan with
`--log-opts="--all --full-history --root -m"`, (4) fails closed on any warning/error even
when Gitleaks exits 0.

**Tech Stack:** Node 22 (`node:test`, `node:child_process`, `node:crypto`, global `fetch`),
Gitleaks 8.30.1 standalone release binaries (MIT), GitHub Actions with SHA-pinned actions.

**Revision history:** Rev. 1 rejected (merge-history coverage unproven, single-detector
self-test). Rev. 2 (2026-08-11, session ca2a8494) repaired both findings with measured
experiments E1–E5. Rev. 3 (this document) aligns with the PO-accepted slice contract of
2026-08-12: log-opts must semantically include `--all --full-history --root -m`, a
root-commit-only negative test is mandatory (contract test C), evidence packet format
fixed, execution gate = Jira ATLAS-23 comment 12917.

---

## Verified start state (must re-verify at execution time)

- Canonical repo: `DYAI2025/project-atlas-foundation`, local
  `/Users/benjaminpoersch/Projects/project-atlas-foundation`.
- `origin/main` = `dd0b9c59ca2cb63c0fb4a974d3f38497177aeae8` (re-verified 2026-08-12).
- CI: `.github/workflows/ci.yml`, single job/context `check`
  (checkout@`3d3c42e5aac5ba805825da76410c181273ba90b1`,
  setup-node@`820762786026740c76f36085b0efc47a31fe5020`, Node 22,
  `npm ci --ignore-scripts && npm test && node scripts/validate-current-repository.mjs`).
- `package.json` scripts: `test`, `check` only. Baseline: 185 tests, 67 validator checks
  (ATLAS-22 PR #15 state; re-record exact numbers at execution).
- `docs/policies/pr-rules.md:9` already names `check`, `secret-scan`, `vuln-scan` as
  required checks "ab ATLAS-23" (policy-only, BLK-ATLAS-13-01 unenforced).
- No `security/` directory yet. `.gitignore` exists (no `.cache/` entry yet).
- No open ATLAS-23 PR. STOP if any of this drifted.

## Experimental evidence base (2026-08-11, session ca2a8494 — carried forward)

All experiments ran on the EXACT release assets, digests verified against published
`gitleaks_8.30.1_checksums.txt`, on darwin_arm64 (bare metal) and linux_x64 (qemu/colima).

- **E1 (merge history):** default `gitleaks git` scans only 3/6 commits of a synthetic
  evil-merge repo and MISSES a merge-introduced, later-removed secret (exit 0, false
  negative). With `--log-opts="--all --full-history -m"` → exit 1, `slack-bot-token`
  detected at the evil-merge commit. "commits scanned" counts only addition-bearing
  commits (5/6 synthetic, 63/64 ATLAS) → a rev-count invariant is NOT implementable;
  completeness is enforced by Stages 1+2 instead.
- **E2/E3 (detectors, both platforms):** 4 vectors fire and are fully redacted:
  `github-pat`, `slack-bot-token`, `aws-access-token`, `private-key`. Sequential fakes
  (`ghp_ABCDEF…`) do NOT fire (8.30.1 sequence filter) — only the four proven vectors may
  be used; never "improve" them without re-running the experiment.
- **E4 (upstream FAIL-OPEN, 3× measured):** (1) unreadable file → WRN + exit 0;
  (2) corrupt git object → ERR logged but exit 0 + "no leaks found"; (3) invalid
  `--log-opts` → exit 0, nothing scanned. Countermeasures measured:
  `git log --all --full-history -m -p >/dev/null` exits 128 on the same corruption;
  self-test uses the same arg builder as the real scan; output guard on ERR/WRN;
  shallow-clone check.
- **E5 (clean baseline):** full-history scan of `project-atlas-foundation@dd0b9c59`:
  63 commits, 0 findings, ≈0.6 s. Gate can land with a clean baseline; no
  allowlist/baseline mechanism needed in this slice.

**Rev. 3 note on `--root`:** experiments used `--all --full-history -m`. `git log -p`
shows the root-commit diff by default (`log.showRoot=true`), so root additions were
already in the measured scan surface (63 commits include root). The contract nevertheless
demands `--root` literally; it is harmless and is added. Stage 1's root-only vector plus
contract test C empirically prove root coverage on every run — no reliance on git
defaults.

## Pinned tool decision (RETAIN_GITLEAKS_8_30_1)

| Field | Value |
|---|---|
| Tool / tag | gitleaks 8.30.1 / `v8.30.1` |
| Role | **CI SECURITY TOOL — NOT PRODUCT RUNTIME UPSTREAM** |
| Source | `https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1` |
| License | MIT |
| Asset linux_x64 sha256 | `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` |
| Asset darwin_arm64 sha256 | `b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5` |
| Expected `gitleaks version` output | `8.30.1` |

`third_party/upstreams.lock.json` stays UNCHANGED (product/runtime upstreams only). The
pin lives in a new `security/secret-scan.pin.json` self-identifying as CI security tool.

## Vector-hygiene rule (load-bearing, adversarial-review point 8)

The four detector vectors and the self-test key block must NEVER appear as contiguous
plaintext in any committed file — otherwise Stage 3's scan of the real ATLAS history would
flag the gate's own source, and a real-looking credential string would enter the repo
history permanently. All vectors are runtime-assembled from split parts whose individual
lines match no Gitleaks rule (verified: `AKIA` + 16 chars split breaks the
`AKIA[0-9A-Z]{16}` match; the private-key header is split mid-word). The gate itself
enforces this: if a contiguous vector ever leaks into a committed file, `secret-scan`
fails on the real repo — fail-closed by construction.

---

## File-by-file overview

| File | Action | Why |
|---|---|---|
| `security/secret-scan.pin.json` | create | deterministic pin record (digests, version, log-opts, known limitations) |
| `scripts/secret-scan.mjs` | create | fail-closed 5-stage gate; exports pure helpers for hermetic tests |
| `test/secret-scan.test.mjs` | create | hermetic `node --test` unit tests (no network, no real binary) |
| `.github/workflows/secret-scan.yml` | create | dedicated observable context `secret-scan`, `fetch-depth: 0` |
| `package.json` | modify | add `"secret-scan"` script; `test`/`check` untouched |
| `.gitignore` | modify | add `.cache/` (binary cache never committed) |
| `scripts/validate-current-repository.mjs` | modify | bind the new mandatory gate artifacts as invariants |
| `docs/policies/pr-rules.md` | modify | mark `secret-scan` as ACTIVE (vuln-scan stays future scope); enforcement caveat unchanged |
| `.claude/skills/atlas-gated-pr/SKILL.md` | modify | steps 8/13: wait for BOTH `check` and `secret-scan` on the exact SHA |
| `docs/plans/2026-08-12-atlas-23-secret-scan.md` | create | this plan, archived in the slice PR (plan-file hygiene) |

Out of scope / untouched: `third_party/upstreams.lock.json`, contracts/, src/, registry,
branch protection, required-checks wiring, format/lint/type/vuln/license/SBOM gates,
AJV strictTypes warnings, Jira, Confluence, VPS.

---

## Task 1: Baseline verify + branch

**Step 1:** In `/Users/benjaminpoersch/Projects/project-atlas-foundation`:

```bash
git fetch origin
git checkout main
git reset --hard origin/main
git rev-parse HEAD
git status --short
gh pr list --state open
```

Expected: HEAD = `dd0b9c59ca2cb63c0fb4a974d3f38497177aeae8`, clean tree, no open
ATLAS-23 PR. Any mismatch → STOP (`STATE_DRIFT`), report, do not improvise.

**Step 2:** Record baseline counts:

```bash
npm ci --ignore-scripts
npm test 2>&1 | tail -5          # expect 185 pass, 0 fail
node scripts/validate-current-repository.mjs | tail -2   # expect 67 checks, VALIDATION PASSED
```

**Step 3:** Branch:

```bash
git checkout -b ci/ATLAS-23-secret-scan
```

No commit yet.

## Task 2: Pin file

**Files:** Create `security/secret-scan.pin.json`

**Step 1:** Write exactly:

```json
{
  "role": "CI SECURITY TOOL — NOT PRODUCT RUNTIME UPSTREAM",
  "tool": "gitleaks",
  "version": "8.30.1",
  "tag": "v8.30.1",
  "source": "https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1",
  "license": "MIT",
  "expectedVersionOutput": "8.30.1",
  "logOpts": "--all --full-history --root -m",
  "assets": {
    "linux-x64": {
      "name": "gitleaks_8.30.1_linux_x64.tar.gz",
      "sha256": "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
    },
    "darwin-arm64": {
      "name": "gitleaks_8.30.1_darwin_arm64.tar.gz",
      "sha256": "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"
    }
  },
  "knownLimitations": [
    "default git scan misses merge-introduced secrets; -m log-opts required (measured 2026-08-11)",
    "exits 0 despite ERR/WRN skip messages (fail-open); output guard required",
    "exits 0 on invalid --log-opts; runtime self-test with shared arg builder required",
    "'commits scanned' counts only addition-bearing commits; not usable as completeness invariant",
    "sequential-pattern fake tokens are filtered; self-test vectors are pinned, do not alter",
    "any version bump requires re-running the 2026-08-11 experiment suite"
  ]
}
```

**Step 2:** `node -e "JSON.parse(require('node:fs').readFileSync('security/secret-scan.pin.json','utf8')); console.log('parses')"` → `parses`. No commit yet (commit after Task 4 green).

## Task 3: Hermetic unit tests (RED)

**Files:** Create `test/secret-scan.test.mjs`

Test only the exported pure helpers — no network, no real binary, no git. Follow the
existing `node --test` style of `test/g2-authorization-gate.test.mjs`.

**Step 1:** Write:

```js
// Hermetic unit tests for the ATLAS-23 secret-scan gate helpers.
// No network, no gitleaks binary, no git repos — CLI stages are covered by the
// gate's own runtime self-test (Stage 1) and the CI run itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  resolvePlatform,
  verifyDigest,
  buildScanArgs,
  outputGuard,
  interpretScanExit,
  selfTestExpectations,
  assembleVectors
} from '../scripts/secret-scan.mjs'

const pin = JSON.parse(readFileSync(new URL('../security/secret-scan.pin.json', import.meta.url), 'utf8'))

test('pin file: role marker, version, both digests, log-opts', () => {
  assert.equal(pin.role, 'CI SECURITY TOOL — NOT PRODUCT RUNTIME UPSTREAM')
  assert.equal(pin.expectedVersionOutput, '8.30.1')
  assert.equal(pin.logOpts, '--all --full-history --root -m')
  assert.match(pin.assets['linux-x64'].sha256, /^[0-9a-f]{64}$/)
  assert.match(pin.assets['darwin-arm64'].sha256, /^[0-9a-f]{64}$/)
})

test('resolvePlatform maps CI and dev platforms, fails closed on unknown', () => {
  assert.equal(resolvePlatform('linux', 'x64', pin).name, 'gitleaks_8.30.1_linux_x64.tar.gz')
  assert.equal(resolvePlatform('darwin', 'arm64', pin).name, 'gitleaks_8.30.1_darwin_arm64.tar.gz')
  assert.throws(() => resolvePlatform('win32', 'x64', pin), /unsupported platform/)
})

test('verifyDigest accepts matching sha256 and rejects any mismatch', () => {
  const buf = Buffer.from('atlas-digest-probe')
  const good = '0a0f6c9a3901c9d84f8d9e0f4dbcbea9e2d9f6f5f1e1c1b1a1918171615141312'
  assert.equal(verifyDigest(buf, sha256Hex(buf)), true)
  assert.throws(() => verifyDigest(buf, good), /digest mismatch/)
})

test('buildScanArgs pins the exact history traversal and redaction', () => {
  const args = buildScanArgs('/repo', '/tmp/report.json', pin)
  assert.ok(args.includes('git'))
  assert.ok(args.includes('--redact'))
  assert.ok(args.includes('--log-opts=--all --full-history --root -m'))
  assert.ok(args.includes('--report-path'))
  assert.ok(args.includes('--exit-code'))
})

test('outputGuard fails closed on every measured fail-open signature', () => {
  for (const bad of [
    'ERR error="stderr is not empty"',
    'WRN skipping file: permission denied',
    'WRN partial scan',
    'ERR could not read object'
  ]) {
    assert.throws(() => outputGuard(bad), /fail-closed/)
  }
  assert.equal(outputGuard('INF scanned ~1284635 bytes\nINF no leaks found'), true)
})

test('interpretScanExit: 0 clean, 1 findings, anything else tool failure', () => {
  assert.equal(interpretScanExit(0), 'clean')
  assert.equal(interpretScanExit(1), 'findings')
  assert.equal(interpretScanExit(2), 'tool-failure')
  assert.equal(interpretScanExit(126), 'tool-failure')
  assert.equal(interpretScanExit(null), 'tool-failure')
})

test('selfTestExpectations: exactly the 4 proven rules + root-only + evil-merge cases', () => {
  const e = selfTestExpectations()
  assert.deepEqual(
    [...e.requiredRuleIds].sort(),
    ['aws-access-token', 'github-pat', 'private-key', 'slack-bot-token']
  )
  assert.equal(e.requiresRootOnlyDetection, true)
  assert.equal(e.requiresEvilMergeDetection, true)
})

test('vector hygiene: no contiguous vector appears in committed gate sources', () => {
  const vectors = assembleVectors()
  assert.equal(Object.keys(vectors).length, 4)
  for (const file of ['../scripts/secret-scan.mjs', './secret-scan.test.mjs']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    for (const v of Object.values(vectors)) {
      const probe = v.split('\n')[0].slice(0, 24)
      assert.ok(!src.includes(probe), `${file} must not contain assembled vector material`)
    }
  }
})

function sha256Hex(buf) {
  return require('node:crypto') // placeholder — replaced below
}
```

Replace the `sha256Hex` placeholder with a proper import at the top:

```js
import { createHash } from 'node:crypto'
function sha256Hex(buf) { return createHash('sha256').update(buf).digest('hex') }
```

(and delete the placeholder at the bottom).

**Step 2:** Run: `node --test test/secret-scan.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/secret-scan.mjs'`. That is the RED state.

## Task 4: Wrapper implementation (GREEN on unit tests)

**Files:** Create `scripts/secret-scan.mjs`

**Step 1:** Write the full gate. Structure (complete code, ~260 lines):

```js
#!/usr/bin/env node
// ATLAS-23 SECRET_SCAN_ONLY — fail-closed full-history secret scan (Gitleaks 8.30.1).
//
// Stage 0  pin + artifact integrity (sha256 before execution, exact version)
// Stage 1  runtime capability self-test (synthetic repo: root-only secret,
//          evil-merge secret, 4 detector vectors, clean final tree)
// Stage 2  scan-surface completeness precheck (shallow check, git log -p readability)
// Stage 3  real scan with --log-opts="--all --full-history --root -m"
// Stage 4  output guard (fail closed on ERR/WRN even when gitleaks exits 0)
//
// Zero npm dependencies. Every stage exits non-zero on failure; nothing warns-and-continues.
// Vectors are assembled at runtime from split parts — see "vector hygiene" in
// docs/plans/2026-08-12-atlas-23-secret-scan.md. Never inline a contiguous vector.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PIN_PATH = join(HERE, '..', 'security', 'secret-scan.pin.json')
const CACHE_DIR = join(HERE, '..', '.cache', 'secret-scan')

// ---------- pure helpers (exported for hermetic tests) ----------

export function resolvePlatform(platform, arch, pin) {
  const key = `${platform}-${arch}`
  const map = { 'linux-x64': 'linux-x64', 'darwin-arm64': 'darwin-arm64' }
  const assetKey = map[key]
  if (!assetKey || !pin.assets[assetKey]) {
    throw new Error(`secret-scan: unsupported platform ${key} — no pinned asset (fail-closed)`)
  }
  return pin.assets[assetKey]
}

export function verifyDigest(buffer, expectedHex) {
  const actual = createHash('sha256').update(buffer).digest('hex')
  if (actual !== expectedHex) {
    throw new Error(`secret-scan: digest mismatch — expected ${expectedHex}, got ${actual} (fail-closed, possible supply-chain issue)`)
  }
  return true
}

export function buildScanArgs(repoPath, reportPath, pin) {
  // Single source of truth for the traversal: Stage 1 (self-test) and Stage 3
  // (real scan) both use this builder, so broken log-opts fail the self-test.
  return [
    'git', repoPath,
    '--no-banner',
    '--redact',
    '--exit-code', '1',
    '--report-format', 'json',
    '--report-path', reportPath,
    `--log-opts=${pin.logOpts}`
  ]
}

export function outputGuard(capturedOutput) {
  // E4 (2026-08-11): gitleaks 8.30.1 exits 0 while logging ERR/WRN on partial scans.
  const signatures = [/\bERR\b/, /\bWRN\b/]
  for (const sig of signatures) {
    if (sig.test(capturedOutput)) {
      throw new Error(`secret-scan: fail-closed — scanner emitted warning/error output despite exit 0: ${JSON.stringify(capturedOutput.split('\n').find(l => sig.test(l)))}`)
    }
  }
  return true
}

export function interpretScanExit(code) {
  if (code === 0) return 'clean'
  if (code === 1) return 'findings'
  return 'tool-failure'
}

export function selfTestExpectations() {
  return {
    requiredRuleIds: new Set(['github-pat', 'slack-bot-token', 'aws-access-token', 'private-key']),
    requiresRootOnlyDetection: true,
    requiresEvilMergeDetection: true
  }
}

export function assembleVectors() {
  // Runtime assembly keeps contiguous secrets out of committed sources (vector hygiene).
  // Values are the four vectors empirically proven to fire in 8.30.1 (E2/E3);
  // sequential fakes are filtered by the scanner — do not "simplify" these.
  const gh = ['ghp', 'x7K9mQ2pL4vR8nT1wY5bC3dF6hJ0sA9zEq2W'].join('_')
  const slack = ['xoxb', '123456789012', '1234567890123', 'AbCdEfGhIjKlMnOpQrStUvWx'].join('-')
  const aws = ['AKIA', 'QWERTYUIOPASDFGH'].join('')
  const keyHeader = ['-----BEGIN RSA PRIV', 'ATE KEY-----'].join('')
  const keyFooter = ['-----END RSA PRIV', 'ATE KEY-----'].join('')
  const keyBody = [
    'MIIBOgIBAAJBAK5c7XyPmnr3rKUM6HKn6mS2b2Zg7fkZQ2YfW1cVGmB6C4dJ8a2E',
    'x2n1P0N7pQ8yR5tU3vW9zB1cD2eF4gH6iJ8kL0mN2oP4qR6sT8uV0wX2yZ4aB6cQ',
    'AkEA2dq1bK2xT9fY7wV5uS3rQ1pO9nM7lK5jI3hG1fE9dC7bA5z8X6w4V2u0T8sQ'
  ].join('\n')
  return {
    'github-pat': gh,
    'slack-bot-token': slack,
    'aws-access-token': aws,
    'private-key': `${keyHeader}\n${keyBody}\n${keyFooter}`
  }
}

// ---------- impure stages (CLI only) ----------

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  return r
}

function fail(stage, message) {
  console.error(`SECRET-SCAN FAILED [${stage}] ${message}`)
  process.exit(1)
}

function git(repo, args, env = {}) {
  const base = ['-c', 'user.name=selftest', '-c', 'user.email=selftest@invalid', '-c', 'commit.gpgsign=false']
  const r = sh('git', ['-C', repo, ...base, ...args], { env: { ...process.env, ...env } })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r
}

async function stage0(pin) {
  const asset = resolvePlatform(process.platform, process.arch, pin)
  mkdirSync(CACHE_DIR, { recursive: true })
  const tarPath = process.env.SECRET_SCAN_ASSET || join(CACHE_DIR, asset.name)
  if (!existsSync(tarPath)) {
    if (process.env.SECRET_SCAN_ASSET) fail('stage0', `SECRET_SCAN_ASSET points to missing file: ${tarPath}`)
    console.log(`stage0: downloading ${asset.name}`)
    const url = `https://github.com/gitleaks/gitleaks/releases/download/${pin.tag}/${asset.name}`
    const res = await fetch(url)
    if (!res.ok) fail('stage0', `download failed: HTTP ${res.status} (fail-closed, no fallback source)`)
    writeFileSync(tarPath, Buffer.from(await res.arrayBuffer()))
  }
  try {
    verifyDigest(readFileSync(tarPath), asset.sha256)
  } catch (e) {
    fail('stage0', e.message)
  }
  console.log(`stage0: digest verified ${asset.sha256} (${asset.name})`)
  const binDir = join(CACHE_DIR, 'bin')
  mkdirSync(binDir, { recursive: true })
  const tar = sh('tar', ['-xzf', tarPath, '-C', binDir, 'gitleaks'])
  if (tar.status !== 0) fail('stage0', `extraction failed: ${tar.stderr}`)
  const bin = join(binDir, 'gitleaks')
  const v = sh(bin, ['version'])
  if (v.status !== 0 || v.stdout.trim() !== pin.expectedVersionOutput) {
    fail('stage0', `version check failed — expected "${pin.expectedVersionOutput}", got status=${v.status} stdout="${(v.stdout || '').trim()}"`)
  }
  console.log(`stage0: gitleaks version ${v.stdout.trim()} OK`)
  return bin
}

function buildSelfTestRepo(root) {
  const vectors = assembleVectors()
  const env = {
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z'
  }
  sh('git', ['init', '-q', '-b', 'main', root])
  // ROOT commit: aws vector present ONLY here (contract test C — root-commit-only secret).
  writeFileSync(join(root, 'config.txt'), `aws_key=${vectors['aws-access-token']}\n`)
  writeFileSync(join(root, 'base.txt'), 'base\n')
  git(root, ['add', '.'], env); git(root, ['commit', '-q', '-m', 'root'], env)
  // Remove the root-only secret entirely.
  git(root, ['rm', '-q', 'config.txt'], env); git(root, ['commit', '-q', '-m', 'remove config'], env)
  // Normal commit adds gh-pat + private key, later removed (later-removed coverage).
  writeFileSync(join(root, 'creds.txt'), `${vectors['github-pat']}\n${vectors['private-key']}\n`)
  git(root, ['add', '.'], env); git(root, ['commit', '-q', '-m', 'creds'], env)
  git(root, ['rm', '-q', 'creds.txt'], env); git(root, ['commit', '-q', '-m', 'remove creds'], env)
  // Evil merge: slack vector exists in NEITHER parent, introduced by the merge commit itself (E1).
  git(root, ['checkout', '-q', '-b', 'feat'], env)
  writeFileSync(join(root, 'feat.txt'), 'feature\n')
  git(root, ['add', '.'], env); git(root, ['commit', '-q', '-m', 'feat'], env)
  git(root, ['checkout', '-q', 'main'], env)
  git(root, ['merge', '-q', '--no-ff', '--no-commit', 'feat'], env)
  writeFileSync(join(root, 'merge-only.txt'), `token=${vectors['slack-bot-token']}\n`)
  git(root, ['add', '.'], env); git(root, ['commit', '-q', '-m', 'merge feat'], env)
  git(root, ['rm', '-q', 'merge-only.txt'], env); git(root, ['commit', '-q', '-m', 'remove merge secret'], env)
  const rootSha = git(root, ['rev-list', '--max-parents=0', 'HEAD']).stdout.trim()
  const mergeSha = git(root, ['rev-list', '--merges', 'HEAD']).stdout.trim()
  return { rootSha, mergeSha, vectors }
}

function stage1(bin, pin) {
  const dir = mkdtempSync(join(tmpdir(), 'secret-scan-selftest-'))
  try {
    const { rootSha, mergeSha, vectors } = buildSelfTestRepo(dir)
    const report = join(dir, 'report.json')
    const r = sh(bin, buildScanArgs(dir, report, pin))
    if (r.status !== 1) {
      fail('stage1', `self-test expected exit 1 (findings), got ${r.status} — scanner or log-opts regressed (fail-closed)`)
    }
    const findings = JSON.parse(readFileSync(report, 'utf8'))
    const rules = new Set(findings.map(f => f.RuleID))
    for (const required of selfTestExpectations().requiredRuleIds) {
      if (!rules.has(required)) fail('stage1', `self-test missing detector ${required}`)
    }
    if (!findings.some(f => f.Commit === rootSha)) {
      fail('stage1', 'self-test: root-commit-only secret NOT detected — history traversal broken')
    }
    if (!findings.some(f => f.Commit === mergeSha)) {
      fail('stage1', 'self-test: evil-merge secret NOT detected — merge history not scanned')
    }
    const captured = (r.stdout || '') + (r.stderr || '') + readFileSync(report, 'utf8')
    for (const v of Object.values(vectors)) {
      const probe = v.split('\n')[0]
      if (captured.includes(probe)) fail('stage1', 'self-test: redaction failed — raw vector visible in output')
    }
    console.log(`stage1: SELF-TEST PASSED (4 rules, root-only case at ${rootSha.slice(0, 8)}, evil-merge case at ${mergeSha.slice(0, 8)}, redaction verified)`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function stage2(repo) {
  const shallow = sh('git', ['-C', repo, 'rev-parse', '--is-shallow-repository'])
  if (shallow.status !== 0 || shallow.stdout.trim() !== 'false') {
    fail('stage2', `shallow or unreadable repository (got "${shallow.stdout.trim()}") — full history required; use fetch-depth: 0`)
  }
  const count = sh('git', ['-C', repo, 'rev-list', '--count', '--all'])
  if (count.status !== 0 || Number(count.stdout.trim()) < 1) {
    fail('stage2', 'rev-list failed or empty history')
  }
  const readable = sh('git', ['-C', repo, 'log', '--all', '--full-history', '--root', '-m', '-p'], { stdio: ['ignore', 'ignore', 'pipe'] })
  if (readable.status !== 0) {
    fail('stage2', `git log -p over full history failed (exit ${readable.status}) — corrupt/unreadable objects; gitleaks would fail open here (E4.2)`)
  }
  console.log(`stage2: surface OK — ${count.stdout.trim()} reachable revisions, non-shallow, all objects readable`)
}

function stage3and4(bin, pin, repo) {
  const report = join(mkdtempSync(join(tmpdir(), 'secret-scan-report-')), 'report.json')
  const r = sh(bin, buildScanArgs(repo, report, pin))
  const verdict = interpretScanExit(r.status)
  if (verdict === 'findings') {
    const findings = JSON.parse(readFileSync(report, 'utf8'))
    console.error(`SECRET-SCAN FAILED [stage3] ${findings.length} finding(s):`)
    for (const f of findings) {
      console.error(`  ${f.RuleID} at ${String(f.Commit).slice(0, 12)} ${f.File}:${f.StartLine}`)
    }
    process.exit(1)
  }
  if (verdict === 'tool-failure') {
    fail('stage3', `scanner exited ${r.status} — tool failure is a gate failure (fail-closed): ${r.stderr}`)
  }
  try {
    outputGuard((r.stdout || '') + (r.stderr || ''))
  } catch (e) {
    fail('stage4', e.message)
  }
  console.log('stage4: output guard clean')
}

async function main() {
  const repoArgIdx = process.argv.indexOf('--repo')
  const repo = resolve(repoArgIdx > -1 ? process.argv[repoArgIdx + 1] : join(HERE, '..'))
  const pin = JSON.parse(readFileSync(PIN_PATH, 'utf8'))
  const bin = await stage0(pin)
  stage1(bin, pin)
  stage2(repo)
  stage3and4(bin, pin, repo)
  console.log('SECRET-SCAN PASSED')
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch(e => { console.error(`SECRET-SCAN FAILED [unhandled] ${e.stack || e}`); process.exit(1) })
}
```

Implementation notes for the executor:
- The private-key body above is synthetic filler (not a valid DER key) — the `private-key`
  rule matches on the BEGIN/END armor plus content, per E2. If Stage 1 shows the
  `private-key` rule NOT firing with this filler, substitute the exact E2 key block from
  the session-ca2a8494 fixtures (`detrepo`) — split the same way — and note it in the
  evidence packet. Do NOT weaken the 4-rule expectation.
- `outputGuard` uses broad `\bERR\b|\bWRN\b` signatures (stricter than the measured
  strings). If the ATLAS scan trips it on a benign INF-only log, that is a finding to
  report, not to whitelist silently.
- Keep helper exports at top, impure stages below — the unit tests import the module;
  module import must not execute the gate (guarded by `isDirectRun`).

**Step 2:** Run: `node --test test/secret-scan.test.mjs`
Expected: all unit tests PASS.

**Step 3:** Run full suite: `npm test` — expected: baseline 185 + new tests, 0 fail.

**Step 4:** Commit:

```bash
git add security/secret-scan.pin.json scripts/secret-scan.mjs test/secret-scan.test.mjs
git commit -m "ci(ATLAS-23): add fail-closed secret-scan gate core (pinned gitleaks 8.30.1)"
```

## Task 5: Contract evidence runs A–D (local, disposable repos)

All disposable repos under `mktemp -d`; NOTHING committed to ATLAS history. Record every
command + exit code verbatim for the evidence packet.

**Step 1 — A. CLEAN PATH (real repo):**

```bash
node scripts/secret-scan.mjs; echo "exit=$?"
```

Expected: stage0 digest line, stage1 SELF-TEST PASSED (root-only + evil-merge), stage2
`64 reachable revisions` (63 + any new commits — record actual), `SECRET-SCAN PASSED`,
`exit=0`.

**Step 2 — B. NORMAL-COMMIT SECRET (disposable repo):**

```bash
T=$(mktemp -d)
git -C "$T" init -q -b main
python3 - "$T" <<'EOF'
import sys, pathlib
# assemble the AWS vector from parts so this heredoc is also hygiene-clean
pathlib.Path(sys.argv[1], 'leak.txt').write_text('key=' + 'AKIA' + 'QWERTYUIOPASDFGH' + '\n')
EOF
git -C "$T" -c user.name=t -c user.email=t@invalid -c commit.gpgsign=false add . 
git -C "$T" -c user.name=t -c user.email=t@invalid -c commit.gpgsign=false commit -qm leak
node scripts/secret-scan.mjs --repo "$T"; echo "exit=$?"
rm -rf "$T"
```

Expected: `SECRET-SCAN FAILED [stage3] 1 finding(s): aws-access-token …`, `exit=1`.

**Step 3 — C. ROOT-COMMIT-ONLY SECRET (mandatory contract test):**

```bash
T=$(mktemp -d)
git -C "$T" init -q -b main
python3 - "$T" <<'EOF'
import sys, pathlib
pathlib.Path(sys.argv[1], 'root-secret.txt').write_text('key=' + 'AKIA' + 'QWERTYUIOPASDFGH' + '\n')
EOF
G="git -C $T -c user.name=t -c user.email=t@invalid -c commit.gpgsign=false"
$G add .; $G commit -qm root
$G rm -q root-secret.txt; $G commit -qm "remove secret"
grep -r AKIA "$T" --exclude-dir=.git; echo "worktree-grep-exit=$?"   # expect 1: tree clean
node scripts/secret-scan.mjs --repo "$T"; echo "exit=$?"
rm -rf "$T"
```

Expected: worktree grep finds nothing (exit 1), gate output shows `aws-access-token` at
the ROOT commit sha, `exit=1`. This proves the gate does not merely scan HEAD.

**Step 4 — D. TOOL FAILURE (fail closed):**

```bash
# D1: asset override points to a missing file
SECRET_SCAN_ASSET=/nonexistent/gitleaks.tar.gz node scripts/secret-scan.mjs; echo "exit=$?"
# D2: tampered asset (digest mismatch)
cp .cache/secret-scan/gitleaks_8.30.1_*.tar.gz /tmp/tampered.tar.gz
printf 'x' >> /tmp/tampered.tar.gz
SECRET_SCAN_ASSET=/tmp/tampered.tar.gz node scripts/secret-scan.mjs; echo "exit=$?"
rm /tmp/tampered.tar.gz
```

Expected: both `exit=1`; D2 message contains `digest mismatch` and `supply-chain`.

**Step 5 — shallow-clone negative (adversarial point 1):**

```bash
T=$(mktemp -d)
git clone -q --depth 1 file://$PWD "$T/shallow"
node scripts/secret-scan.mjs --repo "$T/shallow"; echo "exit=$?"
rm -rf "$T"
```

Expected: `SECRET-SCAN FAILED [stage2] shallow…`, `exit=1`.

No commit in this task (evidence only).

## Task 6: CI workflow + package.json + .gitignore

**Files:** Create `.github/workflows/secret-scan.yml`; modify `package.json`, `.gitignore`

**Step 1:** `.github/workflows/secret-scan.yml` — exactly:

```yaml
name: secret-scan

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          fetch-depth: 0
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: '22'
      - run: node scripts/secret-scan.mjs
```

Notes: same pinned action SHAs as `ci.yml`; `fetch-depth: 0` is load-bearing (Stage 2
fails closed on shallow anyway — defense in depth); no `npm ci` needed (zero-dependency
wrapper); `contents: read` only, no token reaches the scanner. Job id `secret-scan` →
context name exactly `secret-scan`. `ci.yml` is NOT touched.

**Step 2:** `package.json` — add one script line (nothing else):

```json
    "secret-scan": "node scripts/secret-scan.mjs"
```

**Step 3:** `.gitignore` — append:

```
.cache/
```

**Step 4:** Verify: `npm run secret-scan; echo $?` → PASSED, 0. `git status --short` must
show no `.cache/` entries.

**Step 5:** Commit:

```bash
git add .github/workflows/secret-scan.yml package.json .gitignore
git commit -m "ci(ATLAS-23): dedicated secret-scan CI context with full-history checkout"
```

## Task 7: Validator invariants + policy/skill binding

**Files:** Modify `scripts/validate-current-repository.mjs`, `docs/policies/pr-rules.md`,
`.claude/skills/atlas-gated-pr/SKILL.md`

**Step 1:** Read both checker and checked files first (SKILL step 2 discipline).

**Step 2:** Extend `REQUIRED_FILES` with:

```js
  'security/secret-scan.pin.json',
  'scripts/secret-scan.mjs',
  'test/secret-scan.test.mjs',
  '.github/workflows/secret-scan.yml',
```

**Step 3:** Add an ATLAS-23 invariant block (style-matched to existing blocks):

```js
// ATLAS-23 SECRET_SCAN_ONLY: the secret-scan gate is a mandatory repository
// artifact. Presence + binding checks only — scan correctness is owned by the
// gate's runtime self-test and test/secret-scan.test.mjs, not duplicated here.
{
  const pin = JSON.parse(await readFile('security/secret-scan.pin.json', 'utf8'))
  check('secret-scan pin: role marker', pin.role === 'CI SECURITY TOOL — NOT PRODUCT RUNTIME UPSTREAM')
  check('secret-scan pin: version 8.30.1', pin.version === '8.30.1' && pin.expectedVersionOutput === '8.30.1')
  check('secret-scan pin: full-history log-opts', pin.logOpts === '--all --full-history --root -m')
  check('secret-scan pin: linux digest shape', /^[0-9a-f]{64}$/.test(pin.assets?.['linux-x64']?.sha256 ?? ''))
  check('secret-scan pin: darwin digest shape', /^[0-9a-f]{64}$/.test(pin.assets?.['darwin-arm64']?.sha256 ?? ''))
  const wf = await readFile('.github/workflows/secret-scan.yml', 'utf8')
  check('secret-scan workflow: job id secret-scan', /^\s{2}secret-scan:/m.test(wf))
  check('secret-scan workflow: full-history checkout', wf.includes('fetch-depth: 0'))
  check('secret-scan workflow: contents read only', wf.includes('permissions:\n  contents: read'))
  const wrapper = await readFile('scripts/secret-scan.mjs', 'utf8')
  check('secret-scan wrapper: pinned traversal', wrapper.includes('--all --full-history --root -m') || wrapper.includes('pin.logOpts'))
  check('secret-scan wrapper: self-test stage present', wrapper.includes('SELF-TEST PASSED'))
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  check('package.json: secret-scan script', pkg.scripts?.['secret-scan'] === 'node scripts/secret-scan.mjs')
  const rules = await readFile('docs/policies/pr-rules.md', 'utf8')
  check('pr-rules: secret-scan named as required context', rules.includes('`secret-scan`'))
  const skill = await readFile('.claude/skills/atlas-gated-pr/SKILL.md', 'utf8')
  check('atlas-gated-pr skill: waits for secret-scan context', skill.includes('secret-scan'))
}
```

(Adapt mechanically to the file's actual structure/idioms after reading it; keep the
existing 67 checks byte-identical.)

**Step 4:** `docs/policies/pr-rules.md` — change line 9 only, marking status:

```markdown
- Required CI-Checks ab ATLAS-23: `check`, `secret-scan` (beide aktiv seit
  ATLAS-23 Secret-Scan-Slice), `vuln-scan` (ausstehend, künftiger ATLAS-23-Scope).
```

Enforcement-status paragraph (BLK-ATLAS-13-01) stays untouched.

**Step 5:** `.claude/skills/atlas-gated-pr/SKILL.md` — steps 8 and 13: wait for BOTH
contexts `check` AND `secret-scan` on the exact SHA (minimal wording edit, nothing else).

**Step 6:** Run: `npm run check` — expected: all tests pass, validator prints increased
check count (record: 67 → new number), `VALIDATION PASSED`.

**Step 7:** Copy this plan into the repo (plan-file hygiene):
`docs/plans/2026-08-12-atlas-23-secret-scan.md` (this file — already at that path if
planning session wrote it there; otherwise copy now).

**Step 8:** Commit:

```bash
git add scripts/validate-current-repository.mjs docs/policies/pr-rules.md .claude/skills/atlas-gated-pr/SKILL.md docs/plans/2026-08-12-atlas-23-secret-scan.md
git commit -m "docs(ATLAS-23): bind secret-scan gate into validator, pr-rules and delivery loop"
```

## Task 8: Anti-drift gate, push, PR

**Step 1:** Print the anti-drift block and verify the file list contains ONLY the ten
files from the overview table:

```
JIRA KEY: ATLAS-23
SLICE: SECRET_SCAN_ONLY
BASE SHA: dd0b9c59ca2cb63c0fb4a974d3f38497177aeae8
CHANGED FILES: <git diff --name-only main>
AC TARGET: full-history secret scan including root-only secret
TEST COMMANDS: npm test | npm run check | node scripts/secret-scan.mjs | evidence runs A–D
OUT OF SCOPE: format/lint/type/vuln/license/SBOM/branch-protection/required-checks/VPS
```

Unrelated files in the diff → stop and clean before pushing.

**Step 2:** Push + PR (one PR, no merge):

```bash
git push -u origin ci/ATLAS-23-secret-scan
gh pr create --title "ci(ATLAS-23): fail-closed full-history secret-scan gate (SECRET_SCAN_ONLY)" --body "<summary + evidence pointers + explicit: no G2, do not merge, PO review pending>"
```

**Step 3:** CI on the exact head:

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/project-atlas-foundation <head-sha> 900
gh pr checks <pr> # must show check=success AND secret-scan=success on the head SHA
```

The first `secret-scan` run on ubuntu-latest is the bare-metal linux_x64 confirmation
(closes the qemu caveat from E3). Divergence there → STOP (`REOPEN_SCANNER_CHOICE`).

## Task 9: Fresh checkout (contract F) + adversarial review + evidence packet

**Step 1:** Fresh checkout of the exact head:

```bash
T=$(mktemp -d)
git clone -q https://github.com/DYAI2025/project-atlas-foundation "$T/fresh"
git -C "$T/fresh" checkout -q <head-sha>
cd "$T/fresh" && npm ci --ignore-scripts && npm run check && npm run secret-scan
```

All green; re-run evidence C (root-only disposable repo) against the fresh checkout's
entry point. Record outputs verbatim.

**Step 2:** Adversarial review against the 10 contract challenge points; classify
BLOCKER/IMPORTANT/MINOR. Mapping already designed in:

| Challenge | Countermeasure |
|---|---|
| 1 shallow-clone false green | Stage 2 shallow check + `fetch-depth: 0` |
| 2 HEAD-only scan false green | Stage 1 root-only + evil-merge cases fire every run |
| 3 root commit omitted | `--root` in pinned log-opts + Stage 1 root-only case + evidence C |
| 4 merge history omitted | `-m` in pinned log-opts + Stage 1 evil-merge case (E1) |
| 5 scanner missing → success | Stage 0 fail-closed; evidence D1 |
| 6 unpinned download | sha256 before execution; evidence D2; action SHAs pinned |
| 7 job silently skipped | separate always-on workflow (`pull_request` + push main), no path filter, no `continue-on-error`; PR evidence shows context present |
| 8 test secret in real history | vector-hygiene rule + hygiene unit test + Stage 3 on real repo would fail |
| 9 `check` weakened/renamed | `ci.yml` untouched (diff proves it) |
| 10 scope drift | changed-file list == overview table |

**Step 3:** Return the evidence packet in exactly the contract's 9-section format
(start state, implementation, tests, fresh checkout, git, PR, CI, adversarial review,
scope audit). Then STOP: no merge, no G2 artifact, no Jira/Confluence writes; PO review
next.

---

## Stop conditions (unchanged from Rev. 2 + contract)

- Start-state drift from `main = dd0b9c59…`, dirty tree, unexpected ATLAS-23 PRs → STOP.
- Stage 1 not green on the real CI runner → STOP (`REOPEN_SCANNER_CHOICE`).
- Digest mismatch anywhere → STOP, treat as supply-chain incident, no fallback download.
- Findings in the real ATLAS history at execution time (baseline currently 0) → STOP,
  PO decision (possible real credential).
- Any need to touch approval-boundary items, `upstreams.lock.json`, branch protection,
  Jira, Confluence, VPS → STOP.

## Rollback

Single revert of the slice PR's merge commit removes gate, workflow, pin, tests and
policy/skill edits atomically; `.cache/` is untracked; no external state to unwind.
