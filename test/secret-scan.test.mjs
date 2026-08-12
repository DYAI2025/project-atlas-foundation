// Hermetic unit tests for the ATLAS-23 secret-scan gate helpers.
// No network, no gitleaks binary, no git repos — CLI stages are covered by the
// gate's own runtime self-test (Stage 1) and the CI run itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

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
  const wrongDigest = 'deadbeef'.repeat(8) // valid 64-hex shape, but not this buffer's digest
  assert.match(wrongDigest, /^[0-9a-f]{64}$/)
  assert.notEqual(wrongDigest, sha256Hex(buf))
  assert.equal(verifyDigest(buf, sha256Hex(buf)), true)
  assert.throws(() => verifyDigest(buf, wrongDigest), /digest mismatch/)
})

test('buildScanArgs pins the exact history traversal and redaction', () => {
  assert.deepEqual(buildScanArgs('/repo', '/tmp/report.json', pin), [
    'git', '/repo',
    '--no-banner',
    '--redact',
    '--exit-code', '1',
    '--report-format', 'json',
    '--report-path', '/tmp/report.json',
    '--log-opts=--all --full-history --root -m'
  ])
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

test('outputGuard catches ANSI-colorized level tokens and respects word boundaries', () => {
  // Real gitleaks logs are colorized: \x1b[31mERR\x1b[0m — 'm' abuts 'ERR', so a
  // bare \bERR\b on the raw string is defeated; the guard must strip ANSI first.
  assert.throws(() => outputGuard('\x1b[31mERR\x1b[0m error="x"'), /fail-closed/)
  assert.throws(() => outputGuard('\x1b[90m2:32AM\x1b[0m \x1b[33mWRN\x1b[0m \x1b[1mpartial scan\x1b[0m'), /fail-closed/)
  // Word-boundary sanity: substrings inside larger words must NOT trip the guard.
  assert.equal(outputGuard('INF ERROR-code catalog loaded'), true)
  assert.equal(outputGuard('INF TERRAIN checksum ok'), true)
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
