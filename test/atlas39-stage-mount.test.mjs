// ATLAS-39: the mount guard.
//
// The shell mounts a markup string, which is the one place a hostile Confluence
// page title could become executable DOM. Two barriers stand there, and this
// file is the proof that BOTH of them are real rather than decorative:
//
//   * the renderer escapes everything data-derived (pinned in
//     test/atlas39-render-svg.test.mjs), and
//   * core/stage-mount.mjs refuses any markup outside a fixed allowlist, so a
//     future regression in the escaping does not reach the document.
//
// The counterexamples below therefore include a deliberate simulation of that
// regression: real pipeline output with the escaping undone. A guard that has
// only ever been observed passing is not known to be a guard.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel, selectFocus } from '../viewer/atlas39/core/view-model.mjs'
import { computeLayout } from '../viewer/atlas39/core/layout.mjs'
import { renderStage } from '../viewer/atlas39/core/render-svg.mjs'
import { stageMarkupViolation, STAGE_ELEMENTS, STAGE_ATTRIBUTES } from '../viewer/atlas39/core/stage-mount.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const EVIDENCE = join(repoRoot, 'docs/evidence/atlas-65')
const readEvidence = (name) => JSON.parse(readFileSync(join(EVIDENCE, name), 'utf8'))
const app = readFileSync(join(repoRoot, 'viewer/atlas39/app.mjs'), 'utf8')

const VIEWPORT = { width: 1440, height: 900 }
const DELIVERY = 'ATLAS:confluence:14778372:15171611'

function render(focusId, snapshotMutation) {
  const snapshot = readEvidence('graph-snapshot.json')
  if (snapshotMutation) snapshotMutation(snapshot)
  const vm = buildViewModel(snapshot, readEvidence('provenance.json'))
  const layout = computeLayout(vm, VIEWPORT)
  return renderStage(vm, layout, selectFocus(vm, focusId), {})
}

test('the real stage markup the browser mounts is inside the allowlist', () => {
  for (const focusId of [null, DELIVERY]) {
    assert.equal(stageMarkupViolation(render(focusId)), null, `focus ${focusId}`)
  }
})

test('hostile labels, ids and relation strings still produce mountable markup', () => {
  const markup = render(null, (snapshot) => {
    snapshot.nodes[0].label = '</text><script>alert(1)</script>'
    snapshot.nodes[1].label = '" onload="alert(2)'
    snapshot.nodes[2].label = "'><img src=x onerror=alert(3)>"
    snapshot.edges[0].relation_type = '"><script>alert(4)</script>'
  })
  // The guard enumerates every element and attribute it accepts, so a null
  // verdict is itself the statement that no <script>, no <img> and no on*
  // attribute exists in this markup as structure.
  assert.equal(stageMarkupViolation(markup), null)
  assert.equal(markup.includes('<script'), false)
  assert.equal(markup.includes('<img'), false)
  // The handler text survives — as inert, escaped character data inside an
  // attribute value, which is exactly what it must be.
  assert.ok(markup.includes('&quot; onload=&quot;alert(2)'), 'the handler text must survive as escaped data')
  assert.ok(markup.includes('&lt;script&gt;alert(4)&lt;/script&gt;'), 'the hostile relation type must survive escaped')
})

test('COUNTEREXAMPLE: if the renderer stopped escaping, the guard refuses the mount', () => {
  const escaped = render(null, (snapshot) => {
    snapshot.nodes[0].label = '</text><script>alert(1)</script>'
  })
  assert.equal(stageMarkupViolation(escaped), null)

  // Exactly the markup a broken escapeXml() would have produced. The hostile
  // label reaches the accessible name before it reaches the <title>, so that is
  // where the guard trips first.
  const unescaped = escaped.replaceAll('&lt;', '<').replaceAll('&gt;', '>')
  assert.notEqual(escaped, unescaped, 'the simulation must actually change the markup')
  assert.match(stageMarkupViolation(unescaped), /raw "<" inside aria-label on <g>/)

  // Narrowed to a text node only, so the refusal is the element itself: a
  // <script> that a broken escape put into <title> never reaches the document.
  const textOnly = escaped.replace(
    '<title>&lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>',
    '<title></text><script>alert(1)</script></title>'
  )
  assert.notEqual(escaped, textOnly, 'the text-node simulation must actually change the markup')
  assert.match(stageMarkupViolation(textOnly), /element <script> is not on the stage allowlist/)
})

test('COUNTEREXAMPLE: an attribute breakout is refused before it can carry a handler', () => {
  const escaped = render(null, (snapshot) => {
    snapshot.nodes[0].label = '" onload="alert(1)'
  })
  assert.equal(stageMarkupViolation(escaped), null)

  const unescaped = escaped.replaceAll('&quot;', '"')
  assert.notEqual(escaped, unescaped, 'the simulation must actually change the markup')
  assert.match(stageMarkupViolation(unescaped), /event-handler attribute onload/)
})

test('the guard refuses every executable or unexpected mount shape', () => {
  const cases = [
    ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', /<script> is not on the stage allowlist/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>', /<foreignObject> is not on the stage allowlist/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><image href="x"/></svg>', /<image> is not on the stage allowlist/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><g onclick="alert(1)"></g></svg>', /event-handler attribute onclick/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><g ONLOAD="alert(1)"></g></svg>', /event-handler attribute ONLOAD/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><g xlink:href="x"></g></svg>', /malformed attribute name/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"></a></svg>', /<a> is not on the stage allowlist/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><g style="x"></g></svg>', /attribute style on <g> is not on the stage allowlist/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><!-- x --></svg>', /markup declaration or comment/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><![CDATA[x]]></svg>', /markup declaration or comment/],
    ["<svg xmlns='http://www.w3.org/2000/svg'></svg>", /attribute xmlns on <svg> is not double-quoted/],
    ['<svg xmlns=http://www.w3.org/2000/svg></svg>', /attribute xmlns on <svg> is not double-quoted/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><g class="a<b"></g></svg>', /raw "<" inside class on <g>/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><g class', /attribute class on <g> has no value/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><g ', /unterminated <g> tag/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><g class="a" class', /attribute class on <g> has no value/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><g class="a></g></svg>', /unterminated value for class on <g>/],
    [42, /not a string/]
  ]
  for (const [markup, expected] of cases) {
    const violation = stageMarkupViolation(markup)
    assert.ok(violation !== null, `accepted: ${String(markup).slice(0, 60)}`)
    assert.match(violation, expected)
  }
})

test('the guard is tight enough to refuse even the standalone golden', () => {
  // The golden legitimately inlines a stylesheet; the shell never does. If this
  // ever passes, the allowlist has been widened past what the shell emits.
  const snapshot = readEvidence('graph-snapshot.json')
  const vm = buildViewModel(snapshot, readEvidence('provenance.json'))
  const markup = renderStage(vm, computeLayout(vm, VIEWPORT), selectFocus(vm, null), { styleCss: '.a39-field{fill:#000}' })
  assert.match(stageMarkupViolation(markup), /element <style> is not on the stage allowlist/)
})

test('the allowlist is an enumeration, not a wildcard', () => {
  assert.equal(STAGE_ELEMENTS.has('script'), false)
  assert.equal(STAGE_ELEMENTS.has('foreignObject'), false)
  assert.equal(STAGE_ELEMENTS.has('style'), false)
  for (const attribute of STAGE_ATTRIBUTES) {
    assert.equal(/^on/i.test(attribute), false, `${attribute} looks like an event handler`)
  }
  assert.equal(STAGE_ATTRIBUTES.has('href'), false)
  assert.equal(STAGE_ATTRIBUTES.has('style'), false)
})

test('the shell mounts through the guard and uses no HTML injection sink', () => {
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'createContextualFragment']) {
    assert.equal(app.includes(sink), false, `app.mjs still uses ${sink}`)
  }
  assert.match(app, /stageMarkupViolation/)
  assert.match(app, /parseFromString\(markup, 'image\/svg\+xml'\)/)
  assert.match(app, /dom\.stageHost\.replaceChildren\(document\.importNode\(root, true\)\)/)
  assert.match(app, /E_STAGE_MARKUP_REFUSED/)
})
