// ATLAS-40 core / 4 of 4: screen scene -> WebGL draw calls.
//
// This module replaces core/render-svg.mjs as the renderer of the browser
// success path. It is the only file in the viewer that touches a GPU API.
//
// Three deliberate properties:
//
// 1. FAIL CLOSED. If no WebGL context can be created, or a shader will not
//    compile or link, this throws. It does not quietly fall back to a 2D canvas
//    or to the ATLAS-39 SVG renderer. A fallback would put a picture on screen
//    that looks like success while the thing that was actually asked for — a
//    WebGL graph — is not what the user is looking at.
// 2. NO COLOUR OF ITS OWN. Every colour arrives in the palette argument, which
//    the shell resolves from tokens.css. The design system stays the single
//    source of truth exactly as it is for the SVG stage.
// 3. NO STRINGS ON THE GPU PATH. Only numbers derived from geometry are ever
//    uploaded. Labels are the accessible DOM overlay's business, which is why
//    replacing the renderer cannot reintroduce a markup-injection surface.
//
// GLSL ES 1.00 is used deliberately: WebGL2 accepts it, so one shader source
// serves both context versions and there is no second code path to verify.

export const E_WEBGL_UNAVAILABLE = 'E_WEBGL_UNAVAILABLE'
export const E_WEBGL_CONTEXT_LOST = 'E_WEBGL_CONTEXT_LOST'

export class WebglUnavailableError extends Error {
  constructor(message) {
    super(`${E_WEBGL_UNAVAILABLE}: ${message}`)
    this.name = 'WebglUnavailableError'
    this.code = E_WEBGL_UNAVAILABLE
  }
}

// Floats per vertex. Kept as named constants because a wrong stride is the one
// WebGL mistake that renders *something* and is therefore easy to miss.
const SHAPE_STRIDE = 11 // corner(2) center(2) radius thickness dash colour(4)
const LINE_STRIDE = 7 // position(2) normal colour(4)
const FEATHER = 1.25 // antialiasing band, in device pixels

const SHAPE_VERTEX = `
precision highp float;
attribute vec2 a_corner;
attribute vec2 a_center;
attribute float a_radius;
attribute float a_thickness;
attribute float a_dash;
attribute vec4 a_color;
uniform vec2 u_resolution;
varying vec2 v_local;
varying float v_radius;
varying float v_thickness;
varying float v_dash;
varying vec4 v_color;
void main() {
  float reach = a_radius + a_thickness * 0.5 + 2.0;
  v_local = a_corner * reach;
  v_radius = a_radius;
  v_thickness = a_thickness;
  v_dash = a_dash;
  v_color = a_color;
  vec2 pixel = a_center + v_local;
  vec2 clip = (pixel / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`

// One signed-distance circle covers every round thing the stage draws: a filled
// disc when thickness is zero, a stroked ring otherwise. Dashing is angular, so
// the "this node has no hierarchy path" dash of the SVG stage survives.
const SHAPE_FRAGMENT = `
precision highp float;
varying vec2 v_local;
varying float v_radius;
varying float v_thickness;
varying float v_dash;
varying vec4 v_color;
uniform float u_feather;
void main() {
  float d = length(v_local);
  float alpha;
  if (v_thickness <= 0.0) {
    alpha = 1.0 - smoothstep(v_radius - u_feather, v_radius + u_feather, d);
  } else {
    float half_w = v_thickness * 0.5;
    alpha = (1.0 - smoothstep(half_w - u_feather, half_w + u_feather, abs(d - v_radius)));
  }
  if (v_dash > 0.0) {
    float angle = atan(v_local.y, v_local.x);
    if (fract(angle * v_dash) > 0.5) discard;
  }
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
}
`

const LINE_VERTEX = `
precision highp float;
attribute vec2 a_position;
attribute float a_normal;
attribute vec4 a_color;
uniform vec2 u_resolution;
varying float v_normal;
varying vec4 v_color;
void main() {
  v_normal = a_normal;
  v_color = a_color;
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`

const LINE_FRAGMENT = `
precision highp float;
varying float v_normal;
varying vec4 v_color;
void main() {
  float alpha = 1.0 - smoothstep(0.55, 1.0, abs(v_normal));
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
}
`

// The stage field: the same soft radial wash the SVG stage produced with a
// radialGradient, expressed as a fragment shader so it costs one quad.
const FIELD_VERTEX = `
precision highp float;
attribute vec2 a_corner;
varying vec2 v_uv;
void main() {
  v_uv = a_corner * 0.5 + 0.5;
  gl_Position = vec4(a_corner.x, -a_corner.y, 0.0, 1.0);
}
`

const FIELD_FRAGMENT = `
precision highp float;
varying vec2 v_uv;
uniform vec4 u_glow;
uniform vec4 u_void;
uniform float u_aspect;
void main() {
  vec2 d = vec2((v_uv.x - 0.5) * u_aspect, v_uv.y - 0.46);
  float t = clamp(length(d) / 0.72, 0.0, 1.0);
  gl_FragColor = mix(u_glow, u_void, t);
}
`

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  if (!shader) throw new WebglUnavailableError('the driver refused to create a shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'no log'
    gl.deleteShader(shader)
    throw new WebglUnavailableError(`shader compilation failed: ${log}`)
  }
  return shader
}

function link(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram()
  if (!program) throw new WebglUnavailableError('the driver refused to create a program')
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  // The shaders are owned by the program once attached; deleting the handles
  // here is the normal WebGL lifecycle, not an early free.
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'no log'
    gl.deleteProgram(program)
    throw new WebglUnavailableError(`program linking failed: ${log}`)
  }
  return program
}

const QUAD_CORNERS = [
  [-1, -1], [1, -1], [1, 1],
  [-1, -1], [1, 1], [-1, 1]
]

/** Applies an opacity multiplier without mutating the palette entry. */
const withAlpha = (color, alpha) => [color[0], color[1], color[2], color[3] * alpha]

/** Every visual attribute of a node state, in one place, mirroring stage.css. */
function nodeAppearance(node, palette) {
  const depthStroke = node.depth === null
    ? palette.depthNone
    : node.depth === 0
      ? palette.depth0
      : node.depth === 1
        ? palette.depth1
        : node.depth === 2
          ? palette.depth2
          : palette.depthN
  const dimmed = node.state === 'dim' ? 0.2 : 1
  if (node.state === 'focus') {
    return {
      fill: withAlpha(palette.focusFill, dimmed),
      stroke: withAlpha(palette.focusStroke, dimmed),
      thickness: 2.5,
      halo: withAlpha(palette.haloFocus, 0.55),
      dash: node.depth === null ? 3 : 0
    }
  }
  return {
    fill: withAlpha(palette.discFill, dimmed),
    stroke: withAlpha(depthStroke, dimmed),
    thickness: node.state === 'neighbour' ? 2.25 : 1.5,
    halo: null,
    dash: node.depth === null ? 3 : 0
  }
}

function edgeAppearance(edge, palette) {
  if (edge.state === 'active') return { color: withAlpha(palette.edgeActive, 1), width: 2 }
  if (edge.state === 'dim') return { color: withAlpha(palette.edgeIdle, 0.16), width: 1.25 }
  return { color: withAlpha(palette.edgeIdle, 0.85), width: 1.25 }
}

/**
 * Creates the WebGL stage bound to a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{onContextLost?: (code: string) => void}} [options]
 * @returns {{contextType: string, resize: Function, draw: Function, dispose: Function, drawCount: () => number}}
 * @throws {WebglUnavailableError} when no context, shader or program can be had
 */
export function createWebglStage(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new WebglUnavailableError('no canvas to render into')
  }
  // preserveDrawingBuffer keeps the last frame readable after the draw call
  // returns. That is what lets an acceptance run read real pixels back out of
  // the stage instead of trusting that a draw happened.
  const attributes = {
    alpha: false,
    antialias: true,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  }

  let contextType = 'webgl2'
  let gl = null
  try {
    gl = canvas.getContext('webgl2', attributes)
    if (!gl) {
      contextType = 'webgl'
      gl = canvas.getContext('webgl', attributes)
    }
  } catch (error) {
    throw new WebglUnavailableError(`getContext threw: ${error.message}`)
  }
  if (!gl) throw new WebglUnavailableError('this browser provides no WebGL context for the stage')

  const shapeProgram = link(gl, SHAPE_VERTEX, SHAPE_FRAGMENT)
  const lineProgram = link(gl, LINE_VERTEX, LINE_FRAGMENT)
  const fieldProgram = link(gl, FIELD_VERTEX, FIELD_FRAGMENT)

  const loc = (program, names) => Object.fromEntries(
    names.map((name) => [
      name,
      name.startsWith('u_') ? gl.getUniformLocation(program, name) : gl.getAttribLocation(program, name)
    ])
  )
  const shapeLoc = loc(shapeProgram, ['a_corner', 'a_center', 'a_radius', 'a_thickness', 'a_dash', 'a_color', 'u_resolution', 'u_feather'])
  const lineLoc = loc(lineProgram, ['a_position', 'a_normal', 'a_color', 'u_resolution'])
  const fieldLoc = loc(fieldProgram, ['a_corner', 'u_glow', 'u_void', 'u_aspect'])

  const shapeBuffer = gl.createBuffer()
  const lineBuffer = gl.createBuffer()
  const fieldBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, fieldBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(QUAD_CORNERS.flat()), gl.STATIC_DRAW)

  let device = { width: 1, height: 1, dpr: 1 }
  let draws = 0
  let disposed = false

  const onLost = (event) => {
    event.preventDefault?.()
    options.onContextLost?.(E_WEBGL_CONTEXT_LOST)
  }
  canvas.addEventListener?.('webglcontextlost', onLost)

  function resize(cssWidth, cssHeight, dpr) {
    const ratio = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 3) : 1
    const width = Math.max(1, Math.round(cssWidth * ratio))
    const height = Math.max(1, Math.round(cssHeight * ratio))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    device = { width, height, dpr: ratio }
    gl.viewport(0, 0, width, height)
  }

  function pushShape(target, shape) {
    for (const [cx, cy] of QUAD_CORNERS) {
      target.push(
        cx, cy,
        shape.x * device.dpr, shape.y * device.dpr,
        shape.radius * device.dpr,
        shape.thickness * device.dpr,
        shape.dash,
        shape.color[0], shape.color[1], shape.color[2], shape.color[3]
      )
    }
  }

  function pushSegment(target, a, b, halfWidth, color) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    if (length === 0) return
    // Normal of the segment, scaled to half the stroke width. The fragment
    // shader feathers the outer edge, so the quad is widened by one pixel to
    // give that gradient somewhere to live.
    const w = halfWidth + 1
    const nx = (-dy / length) * w
    const ny = (dx / length) * w
    const corners = [
      { x: a.x + nx, y: a.y + ny, n: 1 },
      { x: a.x - nx, y: a.y - ny, n: -1 },
      { x: b.x + nx, y: b.y + ny, n: 1 },
      { x: b.x - nx, y: b.y - ny, n: -1 }
    ]
    for (const index of [0, 1, 2, 1, 3, 2]) {
      const corner = corners[index]
      target.push(corner.x, corner.y, corner.n, color[0], color[1], color[2], color[3])
    }
  }

  function bindAttributes(entries, stride) {
    let offset = 0
    for (const [location, size] of entries) {
      if (location >= 0) {
        gl.enableVertexAttribArray(location)
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4)
      }
      offset += size
    }
  }

  /**
   * Draws one frame of the projected scene.
   *
   * @param {object} scene the output of projectScene()
   * @param {Record<string, number[]>} palette the output of resolvePalette()
   */
  function draw(scene, palette) {
    if (disposed) return
    gl.clearColor(palette.stageVoid[0], palette.stageVoid[1], palette.stageVoid[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // 1) the stage field
    gl.useProgram(fieldProgram)
    gl.bindBuffer(gl.ARRAY_BUFFER, fieldBuffer)
    bindAttributes([[fieldLoc.a_corner, 2]], 2)
    gl.uniform4fv(fieldLoc.u_glow, palette.stageGlow)
    gl.uniform4fv(fieldLoc.u_void, palette.stageVoid)
    gl.uniform1f(fieldLoc.u_aspect, device.width / Math.max(1, device.height))
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    // 2) edges, behind the nodes exactly as in the SVG stage
    const lineData = []
    for (const edge of scene.edges) {
      const { color, width } = edgeAppearance(edge, palette)
      for (let i = 0; i < edge.points.length - 1; i += 1) {
        pushSegment(
          lineData,
          { x: edge.points[i].x * device.dpr, y: edge.points[i].y * device.dpr },
          { x: edge.points[i + 1].x * device.dpr, y: edge.points[i + 1].y * device.dpr },
          (width * device.dpr) / 2,
          color
        )
      }
    }
    if (lineData.length > 0) {
      gl.useProgram(lineProgram)
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineData), gl.DYNAMIC_DRAW)
      bindAttributes([[lineLoc.a_position, 2], [lineLoc.a_normal, 1], [lineLoc.a_color, 4]], LINE_STRIDE)
      gl.uniform2f(lineLoc.u_resolution, device.width, device.height)
      gl.drawArrays(gl.TRIANGLES, 0, lineData.length / LINE_STRIDE)
    }

    // 3) depth rings, focus halo and node discs
    const shapeData = []
    for (const ring of scene.rings) {
      pushShape(shapeData, {
        x: ring.cx,
        y: ring.cy,
        radius: ring.r,
        thickness: 1,
        dash: ring.unrooted ? 6 : 0,
        color: ring.unrooted ? withAlpha(palette.depthNone, 0.45) : palette.ringStroke
      })
    }
    for (const node of scene.nodes) {
      const look = nodeAppearance(node, palette)
      if (look.halo) {
        // Drawn at haloR — the same number the overlay button is sized with, so
        // the highlight a user sees is exactly the region that answers a click.
        pushShape(shapeData, { x: node.x, y: node.y, radius: node.haloR, thickness: 2, dash: 0, color: look.halo })
      }
      pushShape(shapeData, { x: node.x, y: node.y, radius: node.r, thickness: 0, dash: 0, color: look.fill })
      pushShape(shapeData, { x: node.x, y: node.y, radius: node.r, thickness: look.thickness, dash: look.dash, color: look.stroke })
    }
    if (shapeData.length > 0) {
      gl.useProgram(shapeProgram)
      gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(shapeData), gl.DYNAMIC_DRAW)
      bindAttributes(
        [[shapeLoc.a_corner, 2], [shapeLoc.a_center, 2], [shapeLoc.a_radius, 1], [shapeLoc.a_thickness, 1], [shapeLoc.a_dash, 1], [shapeLoc.a_color, 4]],
        SHAPE_STRIDE
      )
      gl.uniform2f(shapeLoc.u_resolution, device.width, device.height)
      gl.uniform1f(shapeLoc.u_feather, FEATHER * device.dpr)
      gl.drawArrays(gl.TRIANGLES, 0, shapeData.length / SHAPE_STRIDE)
    }

    draws += 1
  }

  function dispose() {
    if (disposed) return
    disposed = true
    canvas.removeEventListener?.('webglcontextlost', onLost)
    for (const buffer of [shapeBuffer, lineBuffer, fieldBuffer]) gl.deleteBuffer(buffer)
    for (const program of [shapeProgram, lineProgram, fieldProgram]) gl.deleteProgram(program)
  }

  return {
    contextType,
    gl,
    resize,
    draw,
    dispose,
    drawCount: () => draws
  }
}
