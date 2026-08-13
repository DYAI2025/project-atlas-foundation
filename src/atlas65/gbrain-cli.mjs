// Serialized runner for the pinned GBrain CLI. Env is an explicit allowlist so a
// stray DATABASE_URL / GBRAIN_DATABASE_URL can never silently retarget the pilot
// brain to Postgres (gbrain config precedence honors those first). PGLite is
// single-writer, so every call is spawnSync — never parallel.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export class GbrainError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export const BUN_MIN = [1, 3, 10]

export function parseBunVersion(text) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(text.trim())
  if (!m) throw new GbrainError('E_GBRAIN_RUNTIME_VERSION', `cannot parse bun version from ${JSON.stringify(text)}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function bunVersionSatisfies(text) {
  const [a, b, c] = parseBunVersion(text)
  const [x, y, z] = BUN_MIN
  return a !== x ? a > x : b !== y ? b > y : c >= z
}

export function bunBinary(processEnv = process.env) {
  const candidate = processEnv.ATLAS65_BUN_BIN || join(processEnv.HOME ?? '', '.bun/bin/bun')
  if (!existsSync(candidate)) {
    throw new GbrainError('E_GBRAIN_RUNTIME_MISSING', `bun binary not found at ${candidate} (set ATLAS65_BUN_BIN to override)`)
  }
  return candidate
}

export function gbrainEnv({ brainHome, sourceId, processEnv = process.env }) {
  const env = {
    PATH: processEnv.PATH,
    HOME: processEnv.HOME,
    GBRAIN_HOME: brainHome,
    GBRAIN_SKIP_STARTUP_HOOKS: '1'
  }
  if (sourceId) env.GBRAIN_SOURCE = sourceId
  return env
}

export function gbrainArgs(args) {
  return ['run', 'src/cli.ts', ...args]
}

export function runGbrain({ checkoutDir, brainHome, sourceId, args, input, allowFailure = false }) {
  const res = spawnSync(bunBinary(), gbrainArgs(args), {
    cwd: checkoutDir,
    env: gbrainEnv({ brainHome, sourceId }),
    input,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  })
  if (res.error) throw new GbrainError('E_GBRAIN_SPAWN', res.error.message)
  if (res.status !== 0 && !allowFailure) {
    throw new GbrainError('E_GBRAIN_CLI', `gbrain ${args[0]} exited ${res.status}: ${res.stderr.slice(-2000)}`)
  }
  return res
}

export function callOp({ checkoutDir, brainHome, sourceId, op, payload }) {
  const res = runGbrain({ checkoutDir, brainHome, sourceId, args: ['call', op, JSON.stringify(payload)] })
  try {
    return JSON.parse(res.stdout)
  } catch {
    throw new GbrainError('E_GBRAIN_CLI', `gbrain call ${op}: output is not JSON: ${res.stdout.slice(0, 500)}`)
  }
}
