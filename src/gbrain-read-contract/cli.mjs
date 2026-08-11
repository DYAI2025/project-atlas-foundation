#!/usr/bin/env node
// gbrain-read / graph-projection contract checker (ATLAS-22, Slice 2).
// Usage: node src/gbrain-read-contract/cli.mjs <request.json> <graph-snapshot.json>
// Exit codes: 0 = contract satisfied, 1 = contract or scope violation
//             (an unresolved project is a denial, not a technical error),
//             2 = technical usage / unreadable / invalid-JSON / registry error.
//
// This checker performs NO read: it never contacts Confluence, never contacts
// gbrain and never generates a snapshot. It validates the two documents it is
// handed and resolves project scope through the canonical writer registry.
//
// Uses process.exitCode + natural termination (no process.exit) so stdout/stderr
// always flush on pipes and redirects.
import { readFileSync } from 'node:fs'
import { loadRegistry, resolveProject, RegistryError } from '../registry/resolve.mjs'
import { validateRequest, validateSnapshot, validateScope, buildResponse } from './validate.mjs'

function emit(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`)
}

function technicalFailure(code, message) {
  emit(buildResponse(null, [{ path: '/', code, message }]))
  process.stderr.write(`gbrain-read-contract: ${message}\n`)
  process.exitCode = 2
}

function readJson(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { error: { code: 'E_UNREADABLE', message: `cannot read file: ${path}` } }
  }
  try {
    return { data: JSON.parse(raw) }
  } catch {
    return { error: { code: 'E_INVALID_JSON', message: `not valid JSON: ${path}` } }
  }
}

function main() {
  const args = process.argv.slice(2)
  if (args.length !== 2) {
    return technicalFailure(
      'E_USAGE',
      'usage: node src/gbrain-read-contract/cli.mjs <request.json> <graph-snapshot.json>'
    )
  }

  const requestRead = readJson(args[0])
  if (requestRead.error) return technicalFailure(requestRead.error.code, requestRead.error.message)
  const snapshotRead = readJson(args[1])
  if (snapshotRead.error) return technicalFailure(snapshotRead.error.code, snapshotRead.error.message)

  // A structurally invalid request cannot be resolved: report it alone rather than
  // deriving scope findings from a selector that is already known to be malformed.
  const requestErrors = validateRequest(requestRead.data)
  if (requestErrors.length > 0) {
    emit(buildResponse(null, requestErrors))
    process.exitCode = 1
    return
  }

  let project
  try {
    // ATLAS_REGISTRY_PATH exists solely so tests can exercise the fail-closed
    // registry error paths end-to-end; the default stays the canonical file.
    const override = process.env.ATLAS_REGISTRY_PATH
    const registry = override ? loadRegistry(override) : loadRegistry()
    project = resolveProject(
      registry,
      requestRead.data.project.selector_kind,
      requestRead.data.project.selector_value
    )
  } catch (error) {
    const code = error instanceof RegistryError ? error.code : 'E_INTERNAL'
    return technicalFailure(code, error.message ?? 'unexpected internal error')
  }

  const snapshotErrors = validateSnapshot(snapshotRead.data)
  // Two different rules, deliberately not collapsed into one:
  //   - Deny by default (DEC-09) is the single most important signal and must never
  //     be masked by unrelated structural findings, so an unresolved project is
  //     always reported regardless of the snapshot's condition.
  //   - The project/source comparisons only become meaningful once the snapshot is
  //     structurally sound; running them on a malformed document would manufacture
  //     derived findings from values that are already known to be invalid.
  const scopeErrors =
    project === null || snapshotErrors.length === 0 ? validateScope(project, snapshotRead.data) : []

  const response = buildResponse(project?.project_id ?? null, [...snapshotErrors, ...scopeErrors])
  emit(response)
  process.exitCode = response.valid ? 0 : 1
}

main()
