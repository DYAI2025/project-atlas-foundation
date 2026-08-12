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
import { tmpdir, devNull } from 'node:os'
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
  // Logs are ANSI-colorized (\x1b[33mWRN\x1b[0m); strip escapes first so \b word
  // boundaries cannot be defeated by color codes adjacent to the level token.
  const plain = capturedOutput.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
  const signatures = [/\bERR\b/, /\bWRN\b/]
  for (const sig of signatures) {
    if (sig.test(plain)) {
      throw new Error(`secret-scan: fail-closed — scanner emitted warning/error output despite exit 0: ${JSON.stringify(plain.split('\n').find(l => sig.test(l)))}`)
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

class GateFailure extends Error {
  constructor(stage, message) {
    super(message)
    this.name = 'GateFailure'
    this.stage = stage
  }
}

// Throw (not process.exit) so try/finally cleanup — e.g. Stage 1's removal of the
// synthetic secret repo — runs on EVERY failure path; main() prints and sets exit 1.
function fail(stage, message) {
  throw new GateFailure(stage, message)
}

// Hermetic env for all self-test git calls: no user/global/system config (hooks,
// hooksPath, signing) and no inherited GIT_* redirection can affect the fixture repo.
function hermeticGitEnv(extra = {}) {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', ...extra }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  return env
}

function git(repo, args, env = {}) {
  const base = ['-c', 'user.name=selftest', '-c', 'user.email=selftest@invalid', '-c', 'commit.gpgsign=false']
  const r = sh('git', ['-C', repo, ...base, ...args], { env: hermeticGitEnv(env) })
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
  git(root, ['init', '-q', '-b', 'main'], env)
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
  const revisions = Number(count.stdout.trim())
  if (count.status !== 0 || !(revisions >= 1)) {
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
    const detail = findings
      .map(f => `  ${f.RuleID} at ${String(f.Commit).slice(0, 12)} ${f.File}:${f.StartLine}`)
      .join('\n')
    fail('stage3', `${findings.length} finding(s):\n${detail}`)
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
  main().catch(e => {
    if (e instanceof GateFailure) {
      console.error(`SECRET-SCAN FAILED [${e.stage}] ${e.message}`)
    } else {
      console.error(`SECRET-SCAN FAILED [unhandled] ${e.stack || e}`)
    }
    process.exit(1)
  })
}
