// ATLAS-39: the workspace shell has no framework and therefore no framework to
// enforce its own contract. These tests are that enforcement — landmarks, the
// keyboard entry points, the design-token boundary, reduced motion, the focus
// treatment, and the rule that the shell never substitutes anything for missing
// graph data. All of it is checkable without a browser, which is what keeps the
// visual gate runnable in CI.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const VIEWER = join(repoRoot, 'viewer/atlas39')
const read = (name) => readFileSync(join(VIEWER, name), 'utf8')

const html = read('index.html')
const tokens = read('tokens.css')
const stageCss = read('stage.css')
const shellCss = read('shell.css')
const app = read('app.mjs')

// Every authored viewer source. The ATLAS-40 renderer modules are listed here
// deliberately: the "no remote resource" and "no fixture fallback" rules below
// are the reason a reader can trust the graph on screen, and a new renderer that
// those rules stopped covering would be a silent hole in exactly that guarantee.
const AUTHORED = [
  'index.html', 'tokens.css', 'stage.css', 'shell.css', 'app.mjs',
  'core/view-model.mjs', 'core/layout.mjs', 'core/render-svg.mjs', 'core/stage-mount.mjs',
  'core/transform.mjs', 'core/scene.mjs', 'core/scene-guard.mjs', 'core/search.mjs', 'core/render-webgl.mjs',
  // ATLAS-40 slice 2. Listed for the same reason as the slice-1 renderer
  // modules: a source the no-fallback and no-remote-resource rules stopped
  // covering would be a hole in the reason a reader can trust this workspace.
  'core/view-state.mjs', 'core/saved-view.mjs', 'core/legend.mjs', 'core/gesture.mjs'
]

// …and the list is the whole directory, not a list someone remembered to grow.
// This slice measured why that has to be mechanical: `viewer/atlas39/core/`
// gained four modules and every test below stayed green while the three
// guarantees AUTHORED drives silently stopped covering them. Measured on the
// pre-slice-2 list, with a `fetch('https://…/fixtures/sample-graph.json')`
// sitting in core/legend.mjs: 21 tests, 21 pass, 0 fail. A list that can fall
// behind the directory is not a guarantee about the directory.
//
// The directory is read as "every file git would carry" — the same
// `--cached --others --exclude-standard` listing test/architecture-diagrams.test.mjs
// builds its fixture repository from — rather than with readdir. Plain readdir
// also counts local detritus that is neither authored nor shipped: measured, a
// gitignored `viewer/atlas39/.DS_Store` turned this red while `git status` on
// the same path reported nothing at all, and a guard that cries wolf is a guard
// that gets weakened. A file git would carry but nobody listed still fires,
// which is the case this exists for.
//
// Scoped to viewer/atlas39 on purpose. `test/helpers/purity.mjs` is a TEST
// helper, not a viewer source — it is never served to a browser, and none of the
// three guarantees below is claimed about it — so it sits outside this directory
// and outside this list by construction rather than by anyone's judgement.
test('AUTHORED is every file under viewer/atlas39, so no source escapes these rules', () => {
  const prefix = 'viewer/atlas39/'
  const carried = execFileSync(
    'git',
    ['-C', repoRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', prefix],
    { encoding: 'utf8' }
  )
    .split('\0')
    .filter(Boolean)
    .map((rel) => rel.slice(prefix.length))
  assert.ok(carried.length > 0, 'the viewer source listing must not be empty')
  assert.deepEqual([...AUTHORED].sort(), carried.sort())
})

test('the shell declares semantic landmarks, each with an accessible name', () => {
  for (const [tag, name] of [
    ['header', 'Workspace'],
    ['nav', 'Graph navigator'],
    ['main', 'Graph stage'],
    ['aside', 'Evidence inspector'],
    ['footer', 'Snapshot status']
  ]) {
    assert.match(html, new RegExp(`<${tag}[^>]*aria-label="${name}"`), `${tag} landmark missing`)
  }
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'exactly one h1')
})

test('a skip link reaches the graph stage', () => {
  assert.match(html, /class="a39-skip" href="#stage"/)
  assert.match(html, /<main[^>]*id="stage"/)
})

test('the inspector toggle is a real disclosure control', () => {
  assert.match(html, /id="inspector-toggle"[\s\S]{0,120}aria-expanded="false"[\s\S]{0,40}aria-controls="inspector"/)
  assert.match(html, /<aside[^>]*id="inspector"/)
})

test('a polite live region exists so focus changes are announced', () => {
  assert.match(html, /id="live"[^>]*role="status"[^>]*aria-live="polite"/)
})

test('the filter input is labelled', () => {
  assert.match(html, /<label[^>]*for="filter"/)
  assert.match(html, /<input[^>]*id="filter"/)
})

test('the three stylesheets are linked in token -> stage -> shell order', () => {
  const order = ['./tokens.css', './stage.css', './shell.css'].map((href) => html.indexOf(href))
  assert.ok(order.every((i) => i > -1), 'a stylesheet is not linked')
  assert.deepEqual(order.slice().sort((a, b) => a - b), order)
})

test('tokens.css is the only stylesheet carrying a colour literal', () => {
  // The lookahead keeps SVG fragment references such as url(#a39-field) out of
  // the match: they start with a hex-looking run but are not colours.
  const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])|\brgba?\(/g
  for (const [name, css] of [['stage.css', stageCss], ['shell.css', shellCss]]) {
    assert.deepEqual(css.match(COLOUR_LITERAL) || [], [], `${name} must reference tokens, not colours`)
  }
  assert.ok((tokens.match(/#[0-9a-fA-F]{6}\b/g) || []).length > 20, 'tokens.css should define the palette')
})

// ATLAS-40: the accessible overlay positions each node button from per-element
// custom properties the shell assigns at runtime. They are deliberately NOT in
// tokens.css — they carry one node's geometry, and a :root default would
// silently stand in for a value the shell failed to set, putting every node at
// the same place. The exemption is paid for by the test directly below it.
const RUNTIME_PROPERTIES = ['--gx', '--gy', '--gr', '--lx', '--ly', '--lw']

test('every design token used by the stage or shell is defined in tokens.css', () => {
  const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
  const used = new Set(
    [...`${stageCss}\n${shellCss}`.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1])
  )
  const undefinedTokens = [...used]
    .filter((name) => !RUNTIME_PROPERTIES.includes(name))
    .filter((name) => !defined.has(name))
    .sort()
  assert.deepEqual(undefinedTokens, [])
})

test('every runtime custom property the stylesheets read is actually set by the shell', () => {
  const used = new Set(
    [...`${stageCss}\n${shellCss}`.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1])
  )
  for (const name of RUNTIME_PROPERTIES) {
    assert.equal(used.has(name), true, `${name} is exempted from tokens.css but no stylesheet reads it`)
    assert.match(app, new RegExp(`setProperty\\('${name}'`), `${name} is read in CSS but never set by app.mjs`)
  }
})

test('reduced motion is honoured in both the stage and the shell', () => {
  assert.match(stageCss, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(shellCss, /@media \(prefers-reduced-motion: reduce\)/)
})

test('a removed outline is always replaced by the gold focus ring', () => {
  for (const [name, css] of [['stage.css', stageCss], ['shell.css', shellCss]]) {
    if (!/outline:\s*(none|0)/.test(css)) continue
    assert.match(css, /:focus-visible/, `${name} removes the outline without a :focus-visible rule`)
    assert.match(css, /--focus-ring/, `${name} removes the outline without using the focus token`)
  }
})

test('the inspector is never removed from the layout — only moved off screen', () => {
  const inspectorRules = [...shellCss.matchAll(/\.a39-inspector\s*\{([^}]*)\}/g)].map((m) => m[1])
  assert.ok(inspectorRules.length > 0)
  for (const body of inspectorRules) assert.equal(/display:\s*none/.test(body), false)
  assert.match(shellCss, /body\[data-inspector="open"\] \.a39-inspector/)
})

test('the layout degrades at narrower widths instead of dropping regions', () => {
  assert.match(shellCss, /@media \(max-width: 1200px\)/)
  assert.match(shellCss, /@media \(max-width: 960px\)/)
  // The stage keeps a grid area at every breakpoint: the graph is the product.
  const stageAreas = (shellCss.match(/"[^"]*stage[^"]*"/g) || []).length
  assert.ok(stageAreas >= 3, 'the stage must stay placed at every breakpoint')
})

test('no viewer asset reaches the network or embeds a remote resource', () => {
  for (const name of AUTHORED) {
    const source = read(name)
    for (const pattern of [/src="https?:/, /href="https?:/, /@import/, /url\(\s*['"]?https?:/, /fetch\(\s*['"]https?:/]) {
      assert.equal(pattern.test(source), false, `${name} matches ${pattern}`)
    }
  }
})

test('the shell has no fixture or demo fallback anywhere in its own sources', () => {
  for (const name of AUTHORED) {
    const source = read(name).toLowerCase()
    for (const forbidden of ['fixtures/', 'sample-graph', 'demo-graph', 'placeholder graph', 'math.random']) {
      assert.equal(source.includes(forbidden), false, `${name} contains "${forbidden}"`)
    }
  }
})

test('an unavailable or refused snapshot produces a visible failure state', () => {
  assert.match(app, /E_SNAPSHOT_UNAVAILABLE/)
  assert.match(app, /Snapshot refused/)
  assert.match(app, /a39-failure/)
  assert.match(app, /Nothing is substituted for the missing data/)
  assert.match(shellCss, /\.a39-failure\s*\{/)
})

test('a missing provenance sidecar degrades the evidence panel without faking it', () => {
  assert.match(app, /provenance = null/)
  assert.match(app, /Provenance sidecar unavailable/)
  assert.match(app, /PROVENANCE_TEXT/)
})

test('the shell exposes the projection-local identifier boundary', () => {
  assert.match(html, /projection-local and are explicitly not canonical entity identifiers/i)
  assert.match(html, /id="stat-scheme"/)
})

test('keyboard operation covers activation, traversal and exit', () => {
  for (const key of ['Enter', "' '", 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape']) {
    assert.ok(app.includes(key), `no handler for ${key}`)
  }
  assert.match(app, /addEventListener\('keydown', onStageKeydown\)/)
})

test('every authored ES module parses', () => {
  for (const name of AUTHORED.filter((n) => n.endsWith('.mjs'))) {
    const result = spawnSync(process.execPath, ['--check', join(VIEWER, name)], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${name}: ${result.stderr}`)
  }
})

test('the accepted ATLAS-65 pilot viewer is left untouched by this ticket', () => {
  const pilot = readFileSync(join(repoRoot, 'viewer/atlas65/index.html'), 'utf8')
  assert.match(pilot, /ATLAS-65 — Real Semantic Atlas \(pilot\)/)
  assert.equal(pilot.includes('a39-'), false)
})
