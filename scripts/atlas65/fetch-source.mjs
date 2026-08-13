#!/usr/bin/env node
// ATLAS-65 stage 1: read the declared real source set from canonical Confluence.
// Routing is resolved through the writer registry FIRST (deny by default),
// the declared source set is read and scope-checked second, credentials third,
// network runs last. Output is written atomically: either a complete verified
// capture exists afterwards, or nothing changed.
//
// Uses process.exitCode + natural termination (no process.exit) so stdout/stderr
// always flush on pipes and redirects.
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRegistry, resolveProject, RegistryError } from '../../src/registry/resolve.mjs'
import { fetchSourceSet, SourceError } from '../../src/atlas65/confluence-source.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const OUT = join(repoRoot, 'out/atlas65/source-capture.json')
const FAILED = Symbol('atlas65-fetch failed')

function fail(message, code = 1) {
  process.stderr.write(`atlas65-fetch: ${message}\n`)
  process.exitCode = code
  return FAILED
}

async function main() {
  const args = process.argv.slice(2)
  const pIdx = args.indexOf('--project')
  if (pIdx === -1 || !args[pIdx + 1]) return fail('usage: fetch-source.mjs --project <project_id>', 2)
  const selector = args[pIdx + 1]

  let project
  try {
    project = resolveProject(loadRegistry(), 'project_id', selector)
  } catch (e) {
    return fail(`${e instanceof RegistryError ? e.code : 'E_INTERNAL'}: ${e.message}`, 2)
  }
  if (project === null) {
    return fail(`E_UNKNOWN_PROJECT: no project matches the supplied selector ${JSON.stringify(selector)}`)
  }

  // ATLAS65_SOURCE_SET_PATH exists solely so tests can exercise the fail-closed
  // config error paths end-to-end; the default stays the canonical file.
  const sourceSetPath = process.env.ATLAS65_SOURCE_SET_PATH || join(repoRoot, 'config/atlas65-source-set.json')
  let sourceSet
  try {
    sourceSet = JSON.parse(readFileSync(sourceSetPath, 'utf8'))
  } catch {
    return fail('E_SOURCE_SET_UNREADABLE: cannot read or parse config/atlas65-source-set.json', 2)
  }
  if (
    sourceSet === null || typeof sourceSet !== 'object' || Array.isArray(sourceSet) ||
    sourceSet.project_selector === null || typeof sourceSet.project_selector !== 'object' ||
    Array.isArray(sourceSet.project_selector)
  ) {
    return fail('E_SOURCE_SET_UNREADABLE: source set has no project_selector object', 2)
  }
  if (sourceSet.project_selector.selector_kind !== 'project_id') {
    return fail(
      `E_SOURCE_SCOPE: source set selector_kind must be "project_id", got ${JSON.stringify(sourceSet.project_selector.selector_kind)}`
    )
  }
  if (sourceSet.project_selector.selector_value !== project.project_id) {
    return fail(`E_SOURCE_SCOPE: source set is declared for ${sourceSet.project_selector.selector_value}, not ${project.project_id}`)
  }

  try {
    const capture = await fetchSourceSet({
      env: process.env,
      sourceSet,
      project,
      capturedAt: new Date().toISOString()
    })
    mkdirSync(dirname(OUT), { recursive: true })
    const tmp = `${OUT}.tmp`
    writeFileSync(tmp, `${JSON.stringify(capture, null, 2)}\n`)
    renameSync(tmp, OUT)
    process.stdout.write(`atlas65-fetch: captured ${capture.pages.length} pages (root ${capture.source.source_id}) -> ${OUT}\n`)
    for (const p of capture.pages) {
      process.stdout.write(`  page ${p.page_id} v${p.version} parent=${p.parent_id ?? '-'} "${p.title}"\n`)
    }
  } catch (e) {
    if (e instanceof SourceError) return fail(`${e.code}: ${e.message}`)
    return fail(`E_INTERNAL: ${e.message}`, 2)
  }
}

await main()
