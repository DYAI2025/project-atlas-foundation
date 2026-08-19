// ATLAS-39: the SVG renderer is the module ATLAS-40 replaces, so its contract
// is pinned here — state classes, accessible names, the roving tab order, and
// above all that everything data-derived is XML-escaped. The shell mounts this
// exact string, so an unescaped label would be an injection hole rather than a
// cosmetic defect.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel, selectFocus } from '../viewer/atlas39/core/view-model.mjs'
import { computeLayout } from '../viewer/atlas39/core/layout.mjs'
import { renderStage, escapeXml } from '../viewer/atlas39/core/render-svg.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const EVIDENCE = join(repoRoot, 'docs/evidence/atlas-65')
const readEvidence = (name) => JSON.parse(readFileSync(join(EVIDENCE, name), 'utf8'))
const VIEWPORT = { width: 1440, height: 900 }

const ROOT = 'ATLAS:confluence:14778372:14778372'
const DELIVERY = 'ATLAS:confluence:14778372:15171611'
const SPRINT = 'ATLAS:confluence:14778372:22478849'

function render(focusId, snapshotMutation) {
  const snapshot = readEvidence('graph-snapshot.json')
  if (snapshotMutation) snapshotMutation(snapshot)
  const vm = buildViewModel(snapshot, readEvidence('provenance.json'))
  const layout = computeLayout(vm, VIEWPORT)
  return renderStage(vm, layout, selectFocus(vm, focusId), {})
}

test('escapeXml neutralises every character that could break out of markup', () => {
  assert.equal(escapeXml(`<script>alert("x")&'`), '&lt;script&gt;alert(&quot;x&quot;)&amp;&apos;')
})

test('a hostile label cannot inject markup into the stage', () => {
  const markup = render(null, (snapshot) => {
    snapshot.nodes[0].label = '</text><script>alert(1)</script>'
  })
  assert.equal(markup.includes('<script>'), false)
  assert.ok(markup.includes('&lt;script&gt;'))
})

test('every real node reaches the stage with its projection-local id', () => {
  const markup = render(null)
  for (const id of [
    'ATLAS:confluence:14778372:14680066',
    ROOT,
    'ATLAS:confluence:14778372:15073290',
    DELIVERY,
    SPRINT
  ]) {
    assert.ok(markup.includes(`data-node-id="${id}"`), `missing ${id}`)
  }
  assert.equal((markup.match(/class="a39-node /g) || []).length, 5)
  assert.equal((markup.match(/class="a39-edge /g) || []).length, 4)
})

test('focus marks exactly one node and the true neighbour set', () => {
  const markup = render(DELIVERY)
  assert.equal((markup.match(/a39-node is-focus/g) || []).length, 1)
  assert.equal((markup.match(/a39-node is-neighbour/g) || []).length, 2)
  assert.equal((markup.match(/a39-node is-dim/g) || []).length, 2)
  assert.equal((markup.match(/a39-edge is-active/g) || []).length, 2)
  assert.equal((markup.match(/a39-edge is-dim/g) || []).length, 2)
})

test('the neutral overview state highlights nothing', () => {
  const markup = render(null)
  assert.equal(markup.includes('is-focus'), false)
  assert.equal(markup.includes('is-neighbour'), false)
  assert.equal((markup.match(/a39-node is-idle/g) || []).length, 5)
  assert.equal((markup.match(/a39-edge is-idle/g) || []).length, 4)
})

test('the tab order is roving — exactly one node is tabbable in every state', () => {
  for (const focusId of [null, DELIVERY, SPRINT]) {
    const markup = render(focusId)
    assert.equal((markup.match(/tabindex="0"/g) || []).length, 1, `focus ${focusId}`)
  }
  assert.match(render(DELIVERY), new RegExp(`data-node-id="${DELIVERY}"[^>]*tabindex="0"`))
})

test('each node carries an accessible name with its level and relation count', () => {
  const markup = render(null)
  assert.ok(markup.includes('aria-label="ATLAS Single Source of Truth, level 0, 3 direct relations"'))
  assert.ok(markup.includes('aria-label="Sprint 2 – Visible Real Semantic Atlas – Sprint Plan, level 2, 1 direct relation"'))
})

test('a node with no hierarchy path says so instead of claiming a level', () => {
  const markup = render(null, (snapshot) => {
    snapshot.edges = snapshot.edges.filter((e) => e.to !== SPRINT)
  })
  assert.ok(markup.includes('no hierarchy path'))
  assert.ok(markup.includes('data-depth="none"'))
})

test('decorative geometry is hidden from assistive technology', () => {
  const markup = render(null)
  assert.match(markup, /<g class="a39-rings" aria-hidden="true">/)
  assert.match(markup, /<g class="a39-edges" aria-hidden="true">/)
})

test('the renderer emits classes, never colours — the design system owns colour', () => {
  const markup = render(DELIVERY)
  const literalColours = markup.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || []
  assert.deepEqual(literalColours, [])
})

test('rendering is deterministic', () => {
  assert.equal(render(DELIVERY), render(DELIVERY))
})

test('an inlined stylesheet makes the output a standalone image', () => {
  const snapshot = readEvidence('graph-snapshot.json')
  const vm = buildViewModel(snapshot, readEvidence('provenance.json'))
  const layout = computeLayout(vm, VIEWPORT)
  const markup = renderStage(vm, layout, selectFocus(vm, null), { styleCss: '.a39-field{fill:#000}' })
  assert.ok(markup.includes('<style>.a39-field{fill:#000}</style>'))
  assert.ok(markup.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))
})
