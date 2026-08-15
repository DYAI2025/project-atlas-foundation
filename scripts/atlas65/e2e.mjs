#!/usr/bin/env node
// ATLAS-65 deterministic local E2E: setup -> fetch -> import -> READBACK-IN-A-
// STRIPPED-PROCESS -> assertions -> evidence copy.
// Stage separation is the persistence proof: generate-snapshot runs as a child
// process whose env deliberately lacks the Confluence credentials, so it is
// physically incapable of re-fetching; it can only read persisted gbrain state.
// Failure idiom: process.exitCode + natural termination so pipes always flush.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  repoRoot, CAPTURE_PATH, RECEIPT_PATH, SNAPSHOT_PATH, PROVENANCE_PATH, CONTRACT_RESPONSE_PATH
} from '../../src/atlas65/paths.mjs'

const FAILED = Symbol('failed')

function fail(message, code = 1) {
  process.stderr.write(`atlas65-e2e: ${message}\n`)
  process.exitCode = code
  return FAILED
}

function stage(name, script, extraArgs, env) {
  process.stdout.write(`\n=== atlas65-e2e: ${name} ===\n`)
  const res = spawnSync(process.execPath, [join(repoRoot, script), ...extraArgs], {
    stdio: 'inherit',
    env
  })
  if (res.status !== 0) return fail(`stage "${name}" failed (exit ${res.status})`)
  return true
}

async function main() {
  const args = process.argv.slice(2)
  const pIdx = args.indexOf('--project')
  if (pIdx === -1 || !args[pIdx + 1]) return fail('usage: e2e.mjs --project <project_id>', 2)
  const selector = args[pIdx + 1]

  if (stage('setup (pinned gbrain + PGLite brain)', 'scripts/atlas65/setup-gbrain.mjs', [], process.env) !== true) return FAILED
  if (stage('fetch (real Confluence source)', 'scripts/atlas65/fetch-source.mjs', ['--project', selector], process.env) !== true) return FAILED
  if (stage('import (write persistence)', 'scripts/atlas65/import-to-gbrain.mjs', ['--project', selector], process.env) !== true) return FAILED

  // Readback in a credential-stripped environment: re-import is impossible here.
  // ATLAS65_BUN_BIN is a runtime binary path, not a credential — forward it so
  // the stripped readback can still locate bun when the default is overridden.
  const stripped = { PATH: process.env.PATH, HOME: process.env.HOME }
  if (process.env.ATLAS65_BUN_BIN) stripped.ATLAS65_BUN_BIN = process.env.ATLAS65_BUN_BIN
  if (stage('snapshot (readback WITHOUT source credentials)', 'scripts/atlas65/generate-snapshot.mjs', ['--project', selector], stripped) !== true) return FAILED

  // Belt-and-suspenders on top of the generator's own contract gate: the
  // persisted contract response itself must report valid === true.
  let contractResponse
  try {
    contractResponse = JSON.parse(readFileSync(CONTRACT_RESPONSE_PATH, 'utf8'))
  } catch {
    return fail('E_CONTRACT_EVIDENCE: cannot read or parse the persisted contract response')
  }
  if (contractResponse.valid !== true) {
    return fail('E_CONTRACT_EVIDENCE: persisted contract response does not report valid === true')
  }

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
  if (snapshot.nodes.length < 2 || snapshot.edges.length < 1) {
    return fail(`E_GRAPH_TOO_SMALL: ${snapshot.nodes.length} nodes / ${snapshot.edges.length} edges — the source set carries no defensible relation; select a different real source set, never invent an edge`)
  }

  // Membership: the snapshot read back WITHOUT credentials must equal exactly
  // this run's captured pages (source_ref IS the Confluence page id) — only the
  // e2e legitimately sees both sides, so only it can assert set equality.
  const capture = JSON.parse(readFileSync(CAPTURE_PATH, 'utf8'))
  const capturedIds = new Set(capture.pages.map((p) => p.page_id))
  const snapshotRefs = new Set(snapshot.nodes.map((n) => n.source_ref))
  const captureOnly = [...capturedIds].filter((id) => !snapshotRefs.has(id))
  const snapshotOnly = [...snapshotRefs].filter((ref) => !capturedIds.has(ref))
  if (captureOnly.length > 0 || snapshotOnly.length > 0) {
    return fail(`E_MEMBERSHIP_MISMATCH: snapshot nodes do not equal this run's captured pages — capture-only: [${captureOnly.join(', ')}] snapshot-only: [${snapshotOnly.join(', ')}]`)
  }

  // Evidence copy (committed): capture WITHOUT page bodies (bodies -> sha256).
  const evidenceDir = join(repoRoot, 'docs/evidence/atlas-65')
  mkdirSync(evidenceDir, { recursive: true })
  const evidenceCapture = {
    ...capture,
    pages: capture.pages.map(({ body_storage, ...rest }) => ({
      ...rest,
      body_storage_sha256: createHash('sha256').update(body_storage).digest('hex'),
      body_storage_length: body_storage.length
    }))
  }
  writeFileSync(join(evidenceDir, 'source-capture-evidence.json'), `${JSON.stringify(evidenceCapture, null, 2)}\n`)
  copyFileSync(RECEIPT_PATH, join(evidenceDir, 'import-receipt.json'))
  copyFileSync(SNAPSHOT_PATH, join(evidenceDir, 'graph-snapshot.json'))
  copyFileSync(PROVENANCE_PATH, join(evidenceDir, 'provenance.json'))
  copyFileSync(CONTRACT_RESPONSE_PATH, join(evidenceDir, 'contract-response.json'))

  process.stdout.write(
    `\natlas65-e2e: SUCCESS\n` +
    `  nodes ${snapshot.nodes.length} / edges ${snapshot.edges.length} (project ${snapshot.project_id}, root ${snapshot.source.source_id})\n` +
    `  pages: ${capture.pages.map((p) => `${p.page_id}@v${p.version}`).join(', ')}\n` +
    `  evidence -> ${evidenceDir}\n` +
    `  view: npm run atlas65:serve  ->  http://127.0.0.1:4365/\n`
  )
}

await main()
