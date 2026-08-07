#!/usr/bin/env node
// Writer-registry resolver CLI (ATLAS-12, Slice 1).
// Usage: node src/registry/cli.mjs --jira-key EYT
//        node src/registry/cli.mjs --root-page-id 7503873
//        node src/registry/cli.mjs --project-id ATLAS
// Exit codes: 0 = resolved, 1 = unknown project (deny by default),
//             2 = technical error (usage / registry unreadable, invalid
//             or ambiguous). Exact matching only; fail closed.
import { loadRegistry, resolveProject, buildResponse, RegistryError } from './resolve.mjs'

const OPTION_TO_SELECTOR = {
  '--project-id': 'project_id',
  '--jira-key': 'jira_key',
  '--root-page-id': 'root_page_id'
}

function emit(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`)
}

function fail(exitCode, code, message) {
  // Defensive normalization: a non-RegistryError must never drop the "code"
  // key from the machine-readable error (E_INTERNAL is not part of the slice
  // contract, only a guard against unexpected runtime errors).
  emit(buildResponse(null, [{ code: code ?? 'E_INTERNAL', message: message ?? 'unexpected internal error' }]))
  process.stderr.write(`registry: ${message ?? 'unexpected internal error'}\n`)
  process.exitCode = exitCode
}

function parseSelector(args) {
  const selectors = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    // Object.hasOwn, never `in`: values like "toString" or "__proto__" must
    // not walk the prototype chain into option handling.
    if (!Object.hasOwn(OPTION_TO_SELECTOR, arg)) {
      throw new RegistryError('E_USAGE', `unknown option "${arg}"`)
    }
    const value = args[i + 1]
    // A token starting with "--" is syntactically an option, never an
    // identifier. Swallowing it as a selector value would turn a usage error
    // ("--jira-key --fuzzy") into a fachlicher deny, which is the wrong
    // contract: unknown option / missing value is technical (E_USAGE, exit 2).
    // Subsumes the known selector options, which all start with "--".
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new RegistryError('E_USAGE', `option "${arg}" requires a value`)
    }
    selectors.push({ kind: OPTION_TO_SELECTOR[arg], value })
    i += 1
  }
  if (selectors.length === 0) {
    throw new RegistryError(
      'E_USAGE',
      'usage: node src/registry/cli.mjs (--project-id | --jira-key | --root-page-id) <value>'
    )
  }
  if (selectors.length > 1) {
    throw new RegistryError('E_USAGE', 'exactly one selector is allowed')
  }
  return selectors[0]
}

function main() {
  let selector
  try {
    selector = parseSelector(process.argv.slice(2))
  } catch (error) {
    return fail(2, error.code, error.message)
  }

  let registry
  try {
    // ATLAS_REGISTRY_PATH exists solely so tests can exercise the fail-closed
    // registry error paths end-to-end; the default stays the canonical file.
    const override = process.env.ATLAS_REGISTRY_PATH
    registry = override ? loadRegistry(override) : loadRegistry()
  } catch (error) {
    return fail(2, error.code, error.message)
  }

  let project
  try {
    project = resolveProject(registry, selector.kind, selector.value)
  } catch (error) {
    return fail(2, error.code, error.message)
  }

  if (project === null) {
    // Expected deny-by-default outcome — machine-readable stdout only.
    emit(buildResponse(null, [{ code: 'E_UNKNOWN_PROJECT', message: 'no project matches the supplied selector' }]))
    process.exitCode = 1
    return
  }

  emit(buildResponse(project))
  process.exitCode = 0
}

main()
