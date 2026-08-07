#!/usr/bin/env node
// Local contract checker CLI (ATLAS-22, Slice 1).
// Usage: node src/local-contract/cli.mjs <request.json>
// Exit codes: 0 = contract satisfied, 1 = contract violated,
//             2 = technical usage error or unreadable/invalid input.
// Uses process.exitCode + natural termination (no process.exit) so
// stdout/stderr always flush on pipes and redirects.
import { readFileSync } from 'node:fs'
import { validateRequest, buildResponse } from './validate.mjs'

function emit(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function technicalFailure(code, message) {
  emit(buildResponse([{ path: '/', code, message }]))
  process.stderr.write(`local-contract: ${message}\n`)
  process.exitCode = 2
}

function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1) {
    return technicalFailure('E_USAGE', 'usage: node src/local-contract/cli.mjs <request.json>')
  }

  let raw
  try {
    raw = readFileSync(args[0], 'utf8')
  } catch {
    return technicalFailure('E_UNREADABLE', `cannot read file: ${args[0]}`)
  }

  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return technicalFailure('E_INVALID_JSON', `not valid JSON: ${args[0]}`)
  }

  const result = validateRequest(data)
  emit(result)
  process.exitCode = result.valid ? 0 : 1
}

main()
