#!/usr/bin/env node
// ATLAS-39 visual verification.
//
// Renders the workspace graph stage from the REAL committed ATLAS-65 evidence
// through the exact modules the browser loads, inlines the stage design tokens,
// and writes the result to test/golden/. The goldens are therefore ordinary SVG
// files: open one in a browser and you are looking at the stage, not at a
// serialised abstraction of it.
//
// That is the whole reason this ticket does not pull in a headless-browser
// stack. The renderer is a pure function of (snapshot, viewport, focus), so a
// byte comparison of its output is a real visual regression gate that runs in
// the existing `npm test` on a plain Node runner, with no new dependency, no
// binary download and no CI change.
//
// What it does NOT verify: font rasterisation, actual painted pixels and
// browser layout of the surrounding shell. Those are covered by the manual
// screenshot evidence described in docs/atlas-39-workspace-shell.md.
//
//   node scripts/atlas39/render-golden.mjs           # regenerate
//   node scripts/atlas39/render-golden.mjs --check    # verify, exit 1 on drift
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel, selectFocus } from '../../viewer/atlas39/core/view-model.mjs'
import { computeLayout } from '../../viewer/atlas39/core/layout.mjs'
import { renderStage } from '../../viewer/atlas39/core/render-svg.mjs'

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
export const EVIDENCE_DIR = join(repoRoot, 'docs/evidence/atlas-65')
export const GOLDEN_DIR = join(repoRoot, 'test/golden')
export const VIEWPORT = { width: 1440, height: 900 }

// The one node whose focused state is pinned: it is the only page in the real
// pilot set with both a parent and a child, so its focused state exercises
// neighbours in both edge directions.
export const FOCUS_NODE_ID = 'ATLAS:confluence:14778372:15171611'

export const GOLDENS = [
  { file: 'atlas39-stage-overview.svg', focusId: null },
  { file: 'atlas39-stage-focus.svg', focusId: FOCUS_NODE_ID }
]

function stageStylesheet() {
  const tokens = readFileSync(join(repoRoot, 'viewer/atlas39/tokens.css'), 'utf8')
  const stage = readFileSync(join(repoRoot, 'viewer/atlas39/stage.css'), 'utf8')
  return `\n${tokens}\n${stage}\n`
}

/** Renders one golden from the committed real evidence. Pure apart from the reads. */
export function renderGolden(focusId) {
  const snapshot = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'graph-snapshot.json'), 'utf8'))
  const provenance = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'provenance.json'), 'utf8'))
  const viewModel = buildViewModel(snapshot, provenance)
  const layout = computeLayout(viewModel, VIEWPORT)
  return renderStage(viewModel, layout, selectFocus(viewModel, focusId), { styleCss: stageStylesheet() })
}

function main() {
  const check = process.argv.includes('--check')
  mkdirSync(GOLDEN_DIR, { recursive: true })
  const drifted = []

  for (const { file, focusId } of GOLDENS) {
    const target = join(GOLDEN_DIR, file)
    const rendered = renderGolden(focusId)
    if (!check) {
      writeFileSync(target, rendered)
      process.stdout.write(`atlas39-golden: wrote ${file}\n`)
      continue
    }
    let committed = ''
    try {
      committed = readFileSync(target, 'utf8')
    } catch (error) {
      drifted.push(`${file}: unreadable (${error.code ?? error.message})`)
      continue
    }
    if (committed !== rendered) drifted.push(`${file}: differs from the committed golden`)
  }

  if (!check) return
  if (drifted.length > 0) {
    process.stderr.write('atlas39-golden: E_VISUAL_DRIFT: the stage no longer renders as recorded\n')
    for (const line of drifted) process.stderr.write(`  - ${line}\n`)
    process.stderr.write('If the change is intended, regenerate with: npm run atlas39:golden\n')
    process.exitCode = 1
    return
  }
  process.stdout.write(`atlas39-golden: ${GOLDENS.length} goldens match\n`)
}

// Importable by the test suite without running the CLI side effects: main()
// runs only when this file is the process entry point.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
