#!/usr/bin/env node
// ATLAS-65 stage 3: READBACK ONLY. Reopens the persisted pinned-gbrain state in a
// fresh process and materializes the gbrain-read/v1 snapshot + provenance sidecar
// from it. It cannot fetch Confluence and cannot import (structural test enforces
// this): if the brain is missing or empty this stage fails — it never rebuilds.
// Defense in depth: after the in-process validation, the existing contract CLI
// (src/gbrain-read-contract/cli.mjs) must also accept request+snapshot (exit 0).
// Failure idiom: process.exitCode + natural termination so pipes always flush.
import { writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadRegistry, resolveProject, RegistryError } from '../../src/registry/resolve.mjs'
import { buildSnapshotFromReadback, validateOrThrow, SnapshotError } from '../../src/atlas65/snapshot.mjs'
import { callOp, GbrainError } from '../../src/atlas65/gbrain-cli.mjs'
import {
  GBRAIN_CHECKOUT, BRAIN_HOME, OUT_DIR,
  SNAPSHOT_PATH, PROVENANCE_PATH, REQUEST_PATH, CONTRACT_RESPONSE_PATH, repoRoot
} from '../../src/atlas65/paths.mjs'

const FAILED = Symbol('failed')

function fail(message, code = 1) {
  process.stderr.write(`atlas65-snapshot: ${message}\n`)
  process.exitCode = code
  return FAILED
}

async function main() {
  const args = process.argv.slice(2)
  const pIdx = args.indexOf('--project')
  if (pIdx === -1 || !args[pIdx + 1]) return fail('usage: generate-snapshot.mjs --project <project_id>', 2)
  const selector = args[pIdx + 1]

  let project
  try {
    project = resolveProject(loadRegistry(), 'project_id', selector)
  } catch (e) {
    return fail(`${e instanceof RegistryError ? e.code : 'E_INTERNAL'}: ${e.message}`, 2)
  }
  if (project === null) return fail(`E_UNKNOWN_PROJECT: no project matches ${JSON.stringify(selector)}`)

  // Torn-state consistency: a config without the PGLite data dir (or vice versa)
  // is NOT a readable persisted brain — refuse rather than half-read.
  if (!existsSync(join(BRAIN_HOME, '.gbrain/config.json')) || !existsSync(join(BRAIN_HOME, '.gbrain/brain.pglite'))) {
    return fail('E_PERSISTENCE_UNAVAILABLE: no persisted pilot brain found — this stage reads persisted state only and never re-imports')
  }

  // All readback ops run source-scoped: import registers the source, so a
  // never-imported brain makes the pinned CLI's strict source resolver throw —
  // which IS the correct fail-closed answer for reading never-imported state.
  const gbrainSourceId = `confluence-${project.root_page_id}`
  const gb = { checkoutDir: GBRAIN_CHECKOUT, brainHome: BRAIN_HOME, sourceId: gbrainSourceId }

  let readback
  try {
    const listed = callOp({ ...gb, op: 'list_pages', payload: { limit: 500 } })
    // Fail closed on unrecognized shape: anything that is neither an array nor
    // { pages: [...] } must never be treated as "empty persistence".
    if (!Array.isArray(listed) && !Array.isArray(listed?.pages)) {
      throw new GbrainError('E_GBRAIN_CLI', `list_pages returned unrecognized shape: ${JSON.stringify(listed).slice(0, 500)}`)
    }
    const pageRows = (Array.isArray(listed) ? listed : listed.pages).filter((p) => (p.slug ?? '').startsWith('pages/'))
    if (pageRows.length >= 500) return fail('E_READBACK_TRUNCATED: list_pages returned the full limit — refusing a possibly truncated readback', 2)
    const pages = []
    const links = []
    const linkKeys = new Set()
    for (const row of pageRows) {
      const page = callOp({ ...gb, op: 'get_page', payload: { slug: row.slug } })
      pages.push({ slug: page.slug ?? row.slug, title: page.title, frontmatter: page.frontmatter ?? {} })
      const linkResult = callOp({ ...gb, op: 'get_links', payload: { slug: row.slug } })
      if (!Array.isArray(linkResult) && !Array.isArray(linkResult?.links)) {
        throw new GbrainError('E_GBRAIN_CLI', `get_links returned unrecognized shape: ${JSON.stringify(linkResult).slice(0, 500)}`)
      }
      for (const l of (Array.isArray(linkResult) ? linkResult : linkResult.links)) {
        const entry = {
          from_slug: l.from_slug ?? l.from, to_slug: l.to_slug ?? l.to,
          link_type: l.link_type, link_source: l.link_source
        }
        const key = JSON.stringify(entry)
        if (!linkKeys.has(key)) { linkKeys.add(key); links.push(entry) }
      }
    }
    readback = { pages, links }
  } catch (e) {
    if (e instanceof GbrainError) return fail(`${e.code}: ${e.message}`)
    return fail(`E_INTERNAL: ${e.message}`, 2)
  }

  try {
    const { snapshot, provenance } = buildSnapshotFromReadback({ project, readback, generatedAt: new Date().toISOString() })
    validateOrThrow(snapshot, project)

    mkdirSync(OUT_DIR, { recursive: true })
    const request = {
      contract_version: '1.0.0',
      request_id: 'atlas65-local-e2e',
      project: { selector_kind: 'project_id', selector_value: project.project_id },
      operation: 'read_graph'
    }
    writeFileSync(REQUEST_PATH, `${JSON.stringify(request, null, 2)}\n`)
    const tmpSnapshot = `${SNAPSHOT_PATH}.tmp`
    writeFileSync(tmpSnapshot, `${JSON.stringify(snapshot, null, 2)}\n`)

    const check = spawnSync(process.execPath, [join(repoRoot, 'src/gbrain-read-contract/cli.mjs'), REQUEST_PATH, tmpSnapshot], { encoding: 'utf8' })
    writeFileSync(CONTRACT_RESPONSE_PATH, check.stdout ?? '')
    if (check.status !== 0) {
      try { unlinkSync(tmpSnapshot) } catch { /* the failure below is the primary signal */ }
      return fail(`E_SNAPSHOT_INVALID: contract CLI rejected the generated snapshot (exit ${check.status}) — see ${CONTRACT_RESPONSE_PATH}`)
    }

    // Atomic pair publish: both artifacts land via tmp+rename, snapshot first,
    // provenance immediately after, so a crash never leaves a fresh snapshot
    // paired with a stale (or half-written) sidecar for longer than the gap
    // between two renames.
    const tmpProvenance = `${PROVENANCE_PATH}.tmp`
    writeFileSync(tmpProvenance, `${JSON.stringify(provenance, null, 2)}\n`)
    renameSync(tmpSnapshot, SNAPSHOT_PATH)
    renameSync(tmpProvenance, PROVENANCE_PATH)
    process.stdout.write(`atlas65-snapshot: ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges from persisted state -> ${SNAPSHOT_PATH}\n`)
  } catch (e) {
    if (e instanceof SnapshotError) {
      return fail(`${e.code}: ${e.message}${e.errors.length ? `\n${JSON.stringify(e.errors, null, 2)}` : ''}`)
    }
    return fail(`E_INTERNAL: ${e.message}`, 2)
  }
}

await main()
