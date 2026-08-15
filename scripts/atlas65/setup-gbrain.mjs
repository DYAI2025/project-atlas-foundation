#!/usr/bin/env node
// ATLAS-65: obtain and initialize the EXACT pinned GBrain locally.
// The pin comes only from third_party/upstreams.lock.json — never hardcoded.
// Checkout lives in third_party/gbrain-checkout/ (gitignored, never vendored).
// The pilot brain lives in out/atlas65/gbrain-home/ (gitignored), isolated via
// GBRAIN_HOME, initialized with --pglite --no-embedding (zero keys, zero network).
// Failure idiom: process.exitCode + natural termination so pipes always flush.
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runGbrain, bunBinary, bunVersionSatisfies, GbrainError } from '../../src/atlas65/gbrain-cli.mjs'
import { repoRoot, GBRAIN_CHECKOUT, BRAIN_HOME } from '../../src/atlas65/paths.mjs'

const FAILED = Symbol('failed')

function fail(message, code = 1) {
  process.stderr.write(`atlas65-setup: ${message}\n`)
  process.exitCode = code
  return FAILED
}

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...opts })
  if (res.error || res.status !== 0) {
    return { failed: true, detail: res.error?.message ?? res.stderr }
  }
  return { failed: false, stdout: res.stdout.trim() }
}

async function main() {
  let lock
  try {
    lock = JSON.parse(readFileSync(join(repoRoot, 'third_party/upstreams.lock.json'), 'utf8'))
  } catch {
    return fail('E_PIN: cannot read third_party/upstreams.lock.json', 2)
  }
  const gbrain = lock.upstreams?.find?.((u) => u.id === 'gbrain')
  if (!gbrain?.source_commit || !gbrain?.source_url) return fail('E_PIN: gbrain entry missing in upstreams.lock.json', 2)

  // 1) Bun runtime gate
  let bun
  try {
    bun = bunBinary()
  } catch (e) {
    return fail(`${e.code}: ${e.message} — install bun (https://bun.sh) then re-run`)
  }
  const version = sh(bun, ['--version'])
  if (version.failed) return fail(`E_GBRAIN_RUNTIME_VERSION: cannot run bun --version: ${version.detail}`)
  if (!bunVersionSatisfies(version.stdout)) {
    return fail(`E_GBRAIN_RUNTIME_VERSION: bun ${version.stdout} < required 1.3.10 — run: bun upgrade`)
  }

  // 2) Pinned checkout (clone once, verify SHA always)
  if (!existsSync(join(GBRAIN_CHECKOUT, '.git'))) {
    const clone = sh('git', ['clone', '--quiet', gbrain.source_url, GBRAIN_CHECKOUT])
    if (clone.failed) return fail(`E_PIN: clone failed: ${clone.detail}`, 2)
    const co = sh('git', ['-C', GBRAIN_CHECKOUT, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', gbrain.source_commit])
    if (co.failed) return fail(`E_PIN: checkout of pinned commit failed: ${co.detail}`, 2)
  }
  const head = sh('git', ['-C', GBRAIN_CHECKOUT, 'rev-parse', 'HEAD'])
  if (head.failed) return fail(`E_PIN: cannot resolve checkout HEAD: ${head.detail}`, 2)
  if (head.stdout !== gbrain.source_commit) {
    return fail(`E_PIN_MISMATCH: checkout HEAD ${head.stdout} != pinned ${gbrain.source_commit} — refusing to run an unpinned gbrain — delete third_party/gbrain-checkout and re-run atlas65:setup`)
  }

  // 3) Dependencies (postinstall is best-effort upstream and never fails the install)
  if (!existsSync(join(GBRAIN_CHECKOUT, 'node_modules'))) {
    const install = sh(bun, ['install'], { cwd: GBRAIN_CHECKOUT })
    if (install.failed) return fail(`E_GBRAIN_INSTALL: bun install failed: ${install.detail}`, 2)
  }

  // 4) Brain init (idempotent; PGLite; embedding deliberately disabled for the pilot)
  mkdirSync(BRAIN_HOME, { recursive: true })
  const configPath = join(BRAIN_HOME, '.gbrain/config.json')
  const dataPath = join(BRAIN_HOME, '.gbrain/brain.pglite')
  // Torn-state guard: config.json without the PGLite data dir must never skip
  // init — the next gbrain op would silently fabricate an EMPTY brain (upstream
  // connectEngine creates missing PGLite dirs on connect).
  if (existsSync(configPath) && !existsSync(dataPath)) {
    return fail('E_GBRAIN_TORN_STATE: config.json exists but brain.pglite data dir is missing — delete out/atlas65/gbrain-home and re-run atlas65:setup')
  }
  if (!existsSync(configPath)) {
    let res
    try {
      res = runGbrain({
        checkoutDir: GBRAIN_CHECKOUT,
        brainHome: BRAIN_HOME,
        args: ['init', '--pglite', '--no-embedding', '--json']
      })
    } catch (e) {
      return fail(`${e instanceof GbrainError ? e.code : 'E_INTERNAL'}: ${e.message}`)
    }
    // Observed against the pinned commit: init stdout is multi-line — human
    // preamble, a {"phase":...} progress line, then the success envelope as the
    // LAST line. Only the envelope extraction is adapted; parse/shape failures
    // still fail closed.
    let parsed
    try {
      const lines = res.stdout.trim().split('\n')
      parsed = JSON.parse(lines[lines.length - 1] ?? '')
    } catch {
      return fail(`E_GBRAIN_INIT: init output has no JSON envelope on last line: ${res.stdout.slice(0, 500)}`)
    }
    if (parsed.status !== 'success' || parsed.engine !== 'pglite') {
      return fail(`E_GBRAIN_INIT: unexpected init result ${JSON.stringify(parsed)}`)
    }
  }
  if (!existsSync(configPath)) return fail('E_GBRAIN_INIT: config.json missing after init')
  if (!existsSync(dataPath)) {
    return fail('E_GBRAIN_TORN_STATE: brain.pglite data dir missing beside config.json — delete out/atlas65/gbrain-home and re-run atlas65:setup')
  }

  process.stdout.write(
    `atlas65-setup: OK\n` +
    `  gbrain pin      ${gbrain.version} @ ${head.stdout}\n` +
    `  bun             ${version.stdout}\n` +
    `  checkout        ${GBRAIN_CHECKOUT}\n` +
    `  brain (PGLite)  ${join(BRAIN_HOME, '.gbrain/brain.pglite')}\n`
  )
}

await main()
