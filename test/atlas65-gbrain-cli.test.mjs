import test from 'node:test'
import assert from 'node:assert/strict'
import { gbrainEnv, gbrainArgs, parseBunVersion, bunVersionSatisfies } from '../src/atlas65/gbrain-cli.mjs'

test('gbrainEnv is an allowlist: DATABASE_URL can never leak into gbrain', () => {
  const env = gbrainEnv({
    brainHome: '/abs/brain',
    sourceId: 'confluence-900000001',
    processEnv: { PATH: '/usr/bin', HOME: '/Users/x', DATABASE_URL: 'postgres://evil', GBRAIN_DATABASE_URL: 'postgres://evil2' }
  })
  assert.equal(env.DATABASE_URL, undefined)
  assert.equal(env.GBRAIN_DATABASE_URL, undefined)
  assert.equal(env.GBRAIN_HOME, '/abs/brain')
  assert.equal(env.GBRAIN_SOURCE, 'confluence-900000001')
  assert.equal(env.GBRAIN_SKIP_STARTUP_HOOKS, '1')
})

test('gbrainArgs runs the pinned checkout CLI through bun', () => {
  assert.deepEqual(gbrainArgs(['put', 'pages/900000001']), ['run', 'src/cli.ts', 'put', 'pages/900000001'])
})

test('bun version gate', () => {
  assert.deepEqual(parseBunVersion('1.3.10'), [1, 3, 10])
  assert.equal(bunVersionSatisfies('1.3.10'), true)
  assert.equal(bunVersionSatisfies('1.4.0'), true)
  assert.equal(bunVersionSatisfies('1.2.20'), false)
})
