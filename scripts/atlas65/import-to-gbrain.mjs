#!/usr/bin/env node
// ATLAS-65 stage 2: project the verified capture into the pinned local GBrain.
// This is the ONLY writer. Scope is fail-closed: registry-resolved project must
// match the capture's project AND registered root. The capture is structurally
// re-validated here because it crossed a disk boundary since fetch verified it.
// Pages are written before links (gbrain refuses links whose endpoints do not
// exist). Every gbrain call is serialized (PGLite single-writer).
// Failure idiom: process.exitCode + natural termination so pipes always flush.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadRegistry, resolveProject, RegistryError } from '../../src/registry/resolve.mjs'
import { buildProjection, ProjectionError } from '../../src/atlas65/projection.mjs'
import { runGbrain, callOp, GbrainError } from '../../src/atlas65/gbrain-cli.mjs'
import { GBRAIN_CHECKOUT, BRAIN_HOME, CAPTURE_PATH, RECEIPT_PATH, OUT_DIR } from '../../src/atlas65/paths.mjs'

const FAILED = Symbol('failed')

function fail(message, code = 1) {
  process.stderr.write(`atlas65-import: ${message}\n`)
  process.exitCode = code
  return FAILED
}

function validateCaptureShape(capture) {
  if (capture === null || typeof capture !== 'object' || Array.isArray(capture)) return 'capture root must be an object'
  if (typeof capture.project_id !== 'string' || capture.project_id.length === 0) return 'project_id missing'
  if (capture.source?.source_kind !== 'confluence' || typeof capture.source?.source_id !== 'string') return 'source missing or malformed'
  if (typeof capture.captured_at !== 'string' || capture.captured_at.length === 0) return 'captured_at missing'
  if (!Array.isArray(capture.pages) || capture.pages.length === 0) return 'pages missing or empty'
  for (const [i, p] of capture.pages.entries()) {
    if (typeof p?.page_id !== 'string' || p.page_id.length === 0) return `pages[${i}].page_id missing`
    if (typeof p.title !== 'string' || p.title.length === 0) return `pages[${i}].title missing`
    if (!Number.isInteger(p.version)) return `pages[${i}].version missing or not an integer`
    if (p.parent_id !== null && typeof p.parent_id !== 'string') return `pages[${i}].parent_id must be null or string`
    if (typeof p.confluence_url !== 'string' || p.confluence_url.length === 0) return `pages[${i}].confluence_url missing`
    if (typeof p.body_storage !== 'string') return `pages[${i}].body_storage missing`
  }
  return null
}

async function main() {
  const args = process.argv.slice(2)
  const argValue = (flag) => {
    const i = args.indexOf(flag)
    return i === -1 ? null : args[i + 1] ?? null
  }
  const selector = argValue('--project')
  if (!selector) return fail('usage: import-to-gbrain.mjs --project <project_id> [--capture <path>]', 2)
  const capturePath = argValue('--capture') ?? CAPTURE_PATH

  let project
  try {
    project = resolveProject(loadRegistry(), 'project_id', selector)
  } catch (e) {
    return fail(`${e instanceof RegistryError ? e.code : 'E_INTERNAL'}: ${e.message}`, 2)
  }
  if (project === null) return fail(`E_UNKNOWN_PROJECT: no project matches ${JSON.stringify(selector)}`)

  let capture
  try {
    capture = JSON.parse(readFileSync(capturePath, 'utf8'))
  } catch {
    return fail(`E_CAPTURE_UNREADABLE: cannot read capture at ${capturePath} — run atlas65:fetch first; there is no fixture fallback`)
  }
  if (capture?.project_id !== project.project_id || capture?.source?.source_id !== project.root_page_id) {
    return fail(`E_SCOPE: capture is scoped to ${capture?.project_id}/${capture?.source?.source_id}, resolved project is ${project.project_id}/${project.root_page_id}`)
  }
  const shapeError = validateCaptureShape(capture)
  if (shapeError !== null) return fail(`E_CAPTURE_INVALID: ${shapeError}`)
  if (!existsSync(join(BRAIN_HOME, '.gbrain/config.json'))) {
    return fail('E_PERSISTENCE_UNAVAILABLE: pilot brain not initialized — run atlas65:setup first')
  }

  let projection
  try {
    projection = buildProjection(capture)
  } catch (e) {
    return fail(`${e instanceof ProjectionError ? e.code : 'E_INTERNAL'}: ${e.message}`)
  }

  const gb = { checkoutDir: GBRAIN_CHECKOUT, brainHome: BRAIN_HOME, sourceId: projection.gbrain_source_id }

  try {
    // 1) source registration (idempotent)
    const sources = callOp({ ...gb, op: 'sources_list', payload: {} })
    const registered = JSON.stringify(sources).includes(`"${projection.gbrain_source_id}"`)
    if (!registered) {
      callOp({ ...gb, op: 'sources_add', payload: { id: projection.gbrain_source_id, name: `ATLAS-65 Confluence ${capture.source.source_id}` } })
    }

    // 2) pages first
    const pageResults = []
    for (const page of projection.pages) {
      const res = runGbrain({ ...gb, args: ['put', page.slug], input: page.content })
      let parsed = null
      try { parsed = JSON.parse(res.stdout) } catch { /* non-JSON put output tolerated; exit 0 is the gate */ }
      pageResults.push({ slug: page.slug, status: parsed?.status ?? 'ok', chunks: parsed?.chunks ?? null })
    }

    // 3) links second (both endpoints now exist)
    const linkResults = []
    for (const link of projection.links) {
      runGbrain({ ...gb, args: ['link', link.from_slug, link.to_slug, '--link-type', link.link_type, '--link-source', link.link_source] })
      linkResults.push({ ...link, status: 'ok' })
    }

    const head = spawnSync('git', ['-C', GBRAIN_CHECKOUT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
    mkdirSync(OUT_DIR, { recursive: true })
    const receipt = {
      schema_version: '1.0',
      imported_at: new Date().toISOString(),
      project_id: project.project_id,
      gbrain_checkout_commit: head,
      brain_home: BRAIN_HOME,
      gbrain_source_id: projection.gbrain_source_id,
      pages: pageResults,
      links: linkResults
    }
    writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`)
    process.stdout.write(`atlas65-import: wrote ${pageResults.length} pages, ${linkResults.length} links into pinned gbrain (${head.slice(0, 12)}) -> ${RECEIPT_PATH}\n`)
  } catch (e) {
    if (e instanceof GbrainError) return fail(`${e.code}: ${e.message}`)
    return fail(`E_INTERNAL: ${e.message}`, 2)
  }
}

await main()
