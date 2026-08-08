// Fail-closed G2 PO-authorization gate (ATLAS-56).
// Zero dependencies; pure evaluation core + thin gh CLI wrapper.
// Usage: node scripts/g2-authorization-gate.mjs <pr-number> <head-sha>
// Exit 0 ONLY when a valid, pre-existing, PR-specific PO authorization
// artifact is found on the PR; any other outcome (including errors) exits 1.
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// PO identity = repository owner account, per docs/policies/pr-rules.md.
export const PO_LOGIN = 'DYAI2025'
export const REPO = 'DYAI2025/project-atlas-foundation'

// All three lines must start at column 0 — quoted ("> G2-AUTHORIZATION") or
// otherwise indented markers never match.
const MARKER_RE = /^G2-AUTHORIZATION[ \t\r]*$/m
const PR_RE = /^PR:[ \t]*#(\d+)[ \t\r]*$/m
const HEAD_RE = /^HEAD:[ \t]*([0-9a-f]{40})[ \t\r]*$/m
// Audit comments are claims about authorization, never authorization itself.
const AUDIT_RE = /^PO INTEGRATION AUTHORIZATION/m

export function parseAuthorizationArtifact(body) {
  if (typeof body !== 'string') return null
  if (!MARKER_RE.test(body)) return null
  const pr = PR_RE.exec(body)
  const head = HEAD_RE.exec(body)
  if (!pr || !head) return null
  return { pr: Number(pr[1]), head: head[1] }
}

export function evaluateAuthorization(comments, { prNumber, headSha, gateTime } = {}) {
  const blocked = (reasons) => ({ authorized: false, artifact: null, reasons })

  if (!Array.isArray(comments)) return blocked(['comments is not an array'])
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return blocked([`invalid PR number: ${prNumber}`])
  }
  if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha)) {
    return blocked([`invalid head SHA: ${headSha}`])
  }
  const gate = gateTime instanceof Date ? gateTime : new Date(gateTime ?? NaN)
  if (Number.isNaN(gate.getTime())) return blocked([`invalid gate time: ${gateTime}`])

  const reasons = []
  for (const c of comments) {
    const artifact = parseAuthorizationArtifact(c?.body)
    if (!artifact) continue
    const id = c.id ?? '<unknown-id>'
    if (AUDIT_RE.test(c.body)) {
      reasons.push(`comment ${id}: audit comments never count as authorization artifacts`)
      continue
    }
    const login = c.user?.login
    if (login !== PO_LOGIN) {
      reasons.push(`comment ${id}: author "${login}" is not the PO account (${PO_LOGIN})`)
      continue
    }
    if (artifact.pr !== prNumber) {
      reasons.push(`comment ${id}: artifact targets PR #${artifact.pr}, expected PR #${prNumber}`)
      continue
    }
    if (artifact.head !== headSha) {
      reasons.push(`comment ${id}: artifact head ${artifact.head} does not match expected head ${headSha}`)
      continue
    }
    const effective = new Date(c.updated_at ?? c.created_at ?? NaN)
    if (Number.isNaN(effective.getTime())) {
      reasons.push(`comment ${id}: artifact has no valid timestamp`)
      continue
    }
    if (!(effective.getTime() < gate.getTime())) {
      reasons.push(
        `comment ${id}: artifact effective timestamp ${effective.toISOString()} is not strictly before gate time ${gate.toISOString()}`
      )
      continue
    }
    return { authorized: true, artifact: { id: c.id, url: c.html_url }, reasons: [] }
  }

  if (reasons.length === 0) {
    reasons.push(
      comments.length === 0
        ? 'no comments found on the PR — no authorization artifact exists'
        : 'no comment contains a valid G2-AUTHORIZATION artifact block'
    )
  }
  return blocked(reasons)
}

function fail(message, reasons = []) {
  console.error(message)
  for (const r of reasons) console.error(` ✗ ${r}`)
  console.error('G2 AUTHORIZATION MISSING — merge stays blocked')
  process.exit(1)
}

function main() {
  const [prArg, headArg] = process.argv.slice(2)
  const prNumber = Number(prArg)
  if (!Number.isInteger(prNumber) || prNumber <= 0 || !/^[0-9a-f]{40}$/.test(headArg ?? '')) {
    fail('Usage: node scripts/g2-authorization-gate.mjs <pr-number> <head-sha-40-hex>')
  }
  const res = spawnSync(
    'gh',
    ['api', `repos/${REPO}/issues/${prNumber}/comments`, '--paginate', '--jq', '.[]'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  )
  if (res.error || res.status !== 0) {
    fail(`gh api failed: ${res.stderr?.trim() || res.error?.message || 'unknown error'}`)
  }
  let comments
  try {
    comments = res.stdout
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line))
  } catch {
    fail('could not parse gh api output')
  }
  const verdict = evaluateAuthorization(comments, {
    prNumber,
    headSha: headArg,
    gateTime: new Date(),
  })
  if (!verdict.authorized) {
    fail(`no valid PO authorization artifact for PR #${prNumber} at head ${headArg}`, verdict.reasons)
  }
  console.log(
    `G2 AUTHORIZATION VERIFIED — artifact comment ${verdict.artifact.id} ${verdict.artifact.url}`
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
