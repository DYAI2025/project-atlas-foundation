#!/usr/bin/env node
// ATLAS-25: registry-driven Confluence project discovery and revision scan.
//
// Order is deliberate and fail-closed at every step: project routing through the
// writer registry FIRST (deny by default), previous-scan file SECOND, credentials
// THIRD, network LAST. Output is written atomically — either a complete scan
// exists afterwards, or nothing changed.
//
// Exit codes: 0 = scan written, 1 = fachlicher deny / source failure,
//             2 = technical error (usage, registry, unreadable previous scan).
//
// Uses process.exitCode + natural termination (no process.exit) so stdout/stderr
// always flush on pipes and redirects.
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRegistry, resolveProject, RegistryError } from '../../src/registry/resolve.mjs'
import { discoverProject, applyPrevious, DiscoveryError } from '../../src/atlas25/discovery.mjs'
import { SourceError } from '../../src/atlas65/confluence-source.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const FAILED = Symbol('atlas25-discover failed')
const USAGE = 'usage: discover.mjs --project <project_id> [--previous <path>] [--out <path>]'

function fail(message, code = 1) {
  process.stderr.write(`atlas25-discover: ${message}\n`)
  process.exitCode = code
  return FAILED
}

function parseArgs(argv) {
  const opts = { project: null, previous: null, out: null }
  const known = { '--project': 'project', '--previous': 'previous', '--out': 'out' }
  for (let i = 0; i < argv.length; i += 1) {
    // Object.hasOwn, never `in`: "__proto__" must not resolve as an option.
    if (!Object.hasOwn(known, argv[i])) throw new Error(`unknown option ${JSON.stringify(argv[i])}. ${USAGE}`)
    const value = argv[i + 1]
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new Error(`option ${argv[i]} requires a value. ${USAGE}`)
    }
    opts[known[argv[i]]] = value
    i += 1
  }
  if (opts.project === null) throw new Error(USAGE)
  return opts
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    return fail(e.message, 2)
  }

  // 1) Registry routing — the single source of project scope (DEC-09).
  let project
  try {
    const override = process.env.ATLAS_REGISTRY_PATH
    project = resolveProject(override ? loadRegistry(override) : loadRegistry(), 'project_id', opts.project)
  } catch (e) {
    return fail(`${e instanceof RegistryError ? e.code : 'E_INTERNAL'}: ${e.message}`, 2)
  }
  if (project === null) {
    return fail(`E_UNKNOWN_PROJECT: no project matches the supplied selector ${JSON.stringify(opts.project)}`)
  }
  if (project.status !== 'active') {
    return fail(`E_DISCOVERY_SCOPE: project ${project.project_id} has status ${JSON.stringify(project.status)}, not "active"`)
  }

  // 2) Previous scan — read and parsed before any network use.
  let previous = null
  if (opts.previous !== null) {
    try {
      previous = JSON.parse(readFileSync(opts.previous, 'utf8'))
    } catch {
      return fail(`E_PREVIOUS_UNREADABLE: cannot read or parse ${opts.previous}`, 2)
    }
  }

  const out = opts.out ?? join(repoRoot, `out/atlas25/${project.project_id}/discovery.json`)

  // 3) Credentials + network.
  try {
    let doc = await discoverProject({
      env: process.env,
      project,
      capturedAt: new Date().toISOString()
    })
    doc = await applyPrevious(doc, previous, { env: process.env, project })

    mkdirSync(dirname(out), { recursive: true })
    const tmp = `${out}.tmp`
    writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`)
    renameSync(tmp, out)

    const s = doc.semantic
    process.stdout.write(
      `atlas25-discover: ${s.project_id} root ${s.source.source_id} — ` +
      `${s.pages.length} pages, ${s.discovery.non_page_descendants} non-page descendants, ` +
      `${doc.capture.pagination_requests} cursor request(s), digest ${doc.discovery_digest}\n`
    )
    const byLifecycle = new Map()
    for (const p of s.pages) byLifecycle.set(p.lifecycle, (byLifecycle.get(p.lifecycle) ?? 0) + 1)
    for (const [lifecycle, count] of [...byLifecycle].sort()) {
      process.stdout.write(`  lifecycle ${lifecycle}: ${count}\n`)
    }
    if (s.delta !== null) {
      process.stdout.write(
        `  delta vs ${s.delta.previous_digest}: +${s.delta.added.length} added, ` +
        `${s.delta.version_changed.length} revised, ${s.delta.lifecycle_changed.length} lifecycle-changed, ` +
        `${s.delta.absent.length} absent, ${s.delta.unchanged.length} unchanged\n`
      )
    }
    process.stdout.write(`  written: ${out}\n`)
  } catch (e) {
    if (e instanceof DiscoveryError || e instanceof SourceError) return fail(`${e.code}: ${e.message}`)
    return fail(`E_INTERNAL: ${e.message}`, 2)
  }
}

await main()
