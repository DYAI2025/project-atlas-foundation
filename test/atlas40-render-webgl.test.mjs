// ATLAS-40: the WebGL renderer.
//
// Two questions, both of which a browser-free test can answer honestly.
//
// 1. Does it fail closed? A renderer that cannot start must throw, not fall back.
//    A fallback would put a picture on screen that reads as success while the
//    thing actually asked for is absent. Every way the GPU stack can refuse —
//    no context, a driver that throws, a shader that will not compile, a program
//    that will not link — is exercised here with a stub that refuses in exactly
//    that way.
//
// 2. Does the REAL data reach the GPU? A recording stub captures every buffer
//    upload and draw call, so the vertex counts below are derived from the five
//    real Confluence pages and four real parent_of relations — not from a claim
//    that a draw happened.
//
// What this cannot cover is rasterisation on a real driver. That is what the
// headed browser acceptance run is for, and it is not simulated here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel, selectFocus } from '../viewer/atlas39/core/view-model.mjs'
import { computeLayout } from '../viewer/atlas39/core/layout.mjs'
import { buildScene, projectScene, resolvePalette, EDGE_SEGMENTS } from '../viewer/atlas39/core/scene.mjs'
import { resetTransform } from '../viewer/atlas39/core/transform.mjs'
import {
  createWebglStage,
  WebglUnavailableError,
  E_WEBGL_UNAVAILABLE,
  E_WEBGL_CONTEXT_LOST
} from '../viewer/atlas39/core/render-webgl.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const EVIDENCE_DIR = join(repoRoot, 'docs/evidence/atlas-65')
const VIEWPORT = { width: 1440, height: 900 }
const FOCUS_NODE_ID = 'ATLAS:confluence:14778372:15171611'

const snapshot = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'graph-snapshot.json'), 'utf8'))
const provenance = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'provenance.json'), 'utf8'))
const viewModel = buildViewModel(snapshot, provenance)
const layout = computeLayout(viewModel, VIEWPORT)
const WORLD = { width: layout.width, height: layout.height }

const tokens = readFileSync(join(repoRoot, 'viewer/atlas39/tokens.css'), 'utf8')
const palette = resolvePalette((name) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokens)?.[1] ?? '')

const sceneFor = (focusId) =>
  projectScene(buildScene(viewModel, layout, selectFocus(viewModel, focusId)), resetTransform(WORLD))

/* ---------- stubs ---------- */

const GL_CONSTANTS = {
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  ARRAY_BUFFER: 0x8892,
  FLOAT: 0x1406,
  STATIC_DRAW: 0x88e4,
  DYNAMIC_DRAW: 0x88e8,
  TRIANGLES: 0x0004,
  BLEND: 0x0be2,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  COLOR_BUFFER_BIT: 0x4000
}

/**
 * A recording WebGL context. It answers every call the renderer makes and keeps
 * what was uploaded and drawn, which is what turns "WebGL was used" from a claim
 * into a measurement.
 */
function fakeGl({ compileOk = true, linkOk = true } = {}) {
  const record = { uploads: [], draws: [], programs: 0, shaders: 0, clears: 0 }
  let attribute = 0
  return {
    ...GL_CONSTANTS,
    record,
    createShader: () => ({ id: ++record.shaders }),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => compileOk,
    getShaderInfoLog: () => 'stub compile log',
    deleteShader: () => {},
    createProgram: () => ({ id: ++record.programs }),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => linkOk,
    getProgramInfoLog: () => 'stub link log',
    deleteProgram: () => {},
    getUniformLocation: (program, name) => ({ name }),
    getAttribLocation: () => attribute++,
    createBuffer: () => ({ buffer: true }),
    deleteBuffer: () => {},
    bindBuffer: () => {},
    bufferData: (target, data) => record.uploads.push(data),
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    uniform4fv: () => {},
    uniform2f: () => {},
    uniform1f: () => {},
    useProgram: () => {},
    drawArrays: (mode, first, count) => record.draws.push(count),
    clearColor: () => {},
    clear: () => { record.clears += 1 },
    enable: () => {},
    blendFunc: () => {},
    viewport: () => {}
  }
}

function fakeCanvas(getContext) {
  const listeners = new Map()
  return {
    width: 0,
    height: 0,
    style: {},
    dataset: {},
    getContext,
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type) => listeners.delete(type),
    fire: (type, event) => listeners.get(type)?.(event),
    listenerCount: () => listeners.size
  }
}

/* ---------- fail closed ---------- */

test('no WebGL context is a refusal, not a fallback', () => {
  const canvas = fakeCanvas(() => null)
  assert.throws(
    () => createWebglStage(canvas),
    (error) =>
      error instanceof WebglUnavailableError &&
      error.code === E_WEBGL_UNAVAILABLE &&
      /provides no WebGL context/.test(error.message)
  )
})

test('a driver that throws from getContext is a refusal', () => {
  const canvas = fakeCanvas(() => { throw new Error('GPU process crashed') })
  assert.throws(
    () => createWebglStage(canvas),
    (error) => error.code === E_WEBGL_UNAVAILABLE && /GPU process crashed/.test(error.message)
  )
})

test('a shader that will not compile is a refusal', () => {
  const canvas = fakeCanvas(() => fakeGl({ compileOk: false }))
  assert.throws(
    () => createWebglStage(canvas),
    (error) => error.code === E_WEBGL_UNAVAILABLE && /shader compilation failed: stub compile log/.test(error.message)
  )
})

test('a program that will not link is a refusal', () => {
  const canvas = fakeCanvas(() => fakeGl({ linkOk: false }))
  assert.throws(
    () => createWebglStage(canvas),
    (error) => error.code === E_WEBGL_UNAVAILABLE && /program linking failed: stub link log/.test(error.message)
  )
})

test('an absent canvas is a refusal rather than a silent no-op', () => {
  for (const junk of [null, undefined, {}, 'canvas']) {
    assert.throws(() => createWebglStage(junk), (error) => error.code === E_WEBGL_UNAVAILABLE)
  }
})

test('WebGL 1 is accepted when WebGL 2 is unavailable, and is reported as such', () => {
  const asked = []
  const canvas = fakeCanvas((type) => {
    asked.push(type)
    return type === 'webgl2' ? null : fakeGl()
  })
  const stage = createWebglStage(canvas)
  assert.deepEqual(asked, ['webgl2', 'webgl'])
  assert.equal(stage.contextType, 'webgl')

  const preferred = createWebglStage(fakeCanvas(() => fakeGl()))
  assert.equal(preferred.contextType, 'webgl2')
})

test('a lost context is reported so the shell can fail closed', () => {
  let reported = null
  const canvas = fakeCanvas(() => fakeGl())
  const stage = createWebglStage(canvas, { onContextLost: (code) => { reported = code } })
  let prevented = false
  canvas.fire('webglcontextlost', { preventDefault: () => { prevented = true } })
  assert.equal(reported, E_WEBGL_CONTEXT_LOST)
  assert.equal(prevented, true, 'the default must be prevented or the context can never be restored')

  // Disposal detaches the listener and stops the renderer answering at all.
  stage.dispose()
  assert.equal(canvas.listenerCount(), 0)
  const before = stage.drawCount()
  stage.draw(sceneFor(null), palette)
  assert.equal(stage.drawCount(), before, 'a disposed stage must not keep drawing')
})

/* ---------- the real data reaches the GPU ---------- */

test('the real graph is uploaded to the GPU, counted vertex by vertex', () => {
  const gl = fakeGl()
  const canvas = fakeCanvas(() => gl)
  const stage = createWebglStage(canvas)
  stage.resize(VIEWPORT.width, VIEWPORT.height, 2)
  assert.equal(canvas.width, 2880)
  assert.equal(canvas.height, 1800)

  const scene = sceneFor(null)
  stage.draw(scene, palette)

  // 4 real relations, each tessellated into EDGE_SEGMENTS quads of 6 vertices.
  const expectedLineVertices = 4 * EDGE_SEGMENTS * 6
  // 2 depth rings + 5 real pages, each contributing a filled disc and a stroke.
  // Nothing is focused, so no halo is drawn.
  const expectedShapeVertices = (2 + 5 * 2) * 6
  assert.deepEqual(stage.drawCount(), 1)
  assert.deepEqual(gl.record.draws, [6, expectedLineVertices, expectedShapeVertices])
  assert.equal(gl.record.clears, 1)
})

test('focusing adds exactly one halo to the frame', () => {
  const gl = fakeGl()
  const stage = createWebglStage(fakeCanvas(() => gl))
  stage.resize(VIEWPORT.width, VIEWPORT.height, 1)
  stage.draw(sceneFor(FOCUS_NODE_ID), palette)
  const shapeVertices = gl.record.draws.at(-1)
  assert.equal(shapeVertices, (2 + 5 * 2 + 1) * 6, 'the focused node should contribute a halo shape')
})

test('every float uploaded to the GPU is a real number', () => {
  // A single NaN in a vertex buffer silently removes geometry on most drivers.
  const gl = fakeGl()
  const stage = createWebglStage(fakeCanvas(() => gl))
  stage.resize(VIEWPORT.width, VIEWPORT.height, 2)
  stage.draw(sceneFor(FOCUS_NODE_ID), palette)
  assert.ok(gl.record.uploads.length >= 3)
  for (const upload of gl.record.uploads) {
    assert.ok(upload instanceof Float32Array, 'uploads must be typed arrays')
    for (const value of upload) assert.ok(Number.isFinite(value), 'a non-finite float reached the GPU')
  }
})

test('the halo uploaded to the GPU is the same circle the overlay is sized with', () => {
  // The colour of the halo is what identifies its vertices in the buffer; its
  // radius must equal the hit radius the accessible overlay uses.
  const gl = fakeGl()
  const stage = createWebglStage(fakeCanvas(() => gl))
  stage.resize(VIEWPORT.width, VIEWPORT.height, 1)
  const scene = sceneFor(FOCUS_NODE_ID)
  stage.draw(scene, palette)

  const focused = scene.nodes.find((n) => n.nodeId === FOCUS_NODE_ID)
  const shapes = gl.record.uploads.at(-1)
  const STRIDE = 11
  const radii = new Set()
  for (let i = 0; i < shapes.length; i += STRIDE) {
    // centre x, centre y, radius, thickness
    if (shapes[i + 2] === focused.x && shapes[i + 3] === focused.y && shapes[i + 5] > 0) {
      radii.add(shapes[i + 4])
    }
  }
  assert.ok(radii.has(focused.hitR), `no stroked shape at the focused node has radius ${focused.hitR}`)
})

test('the shader sources are constant and carry no interpolated data', () => {
  // The GPU path must never become a place where a Confluence title can end up.
  const source = readFileSync(join(repoRoot, 'viewer/atlas39/core/render-webgl.mjs'), 'utf8')
  const shaders = [...source.matchAll(/const [A-Z_]+ = `([\s\S]*?)`/g)].map((m) => m[1])
  assert.ok(shaders.length >= 6, `expected the six shader sources, found ${shaders.length}`)
  for (const shader of shaders) {
    assert.equal(shader.includes('${'), false, 'a shader source interpolates a value')
  }
  assert.equal(/gl\.shaderSource\([^,]+,\s*`/.test(source), false, 'shader source must not be built inline')
})
