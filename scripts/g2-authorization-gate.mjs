// Fail-closed G2 PO-authorization gate (ATLAS-56).
// Zero dependencies; pure evaluation core + thin gh CLI wrapper.
// Usage: node scripts/g2-authorization-gate.mjs <pr-number> <head-sha>
// Exit 0 ONLY when a valid, pre-existing, PR-specific PO authorization
// artifact is found on the PR; any other outcome (including errors) exits 1.
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// PO identity = repository owner account, per docs/policies/pr-rules.md.
export const PO_LOGIN = 'DYAI2025'
export const REPO = 'DYAI2025/project-atlas-foundation'

// The artifact is ONE contiguous, visible block: three adjacent lines in fixed
// order, each starting at column 0. Quoted ("> G2-AUTHORIZATION"), indented,
// scattered or reordered lines never match.
const BLOCK_RE =
  /^G2-AUTHORIZATION[ \t]*\r?\nPR:[ \t]*#(\d+)[ \t]*\r?\nHEAD:[ \t]*([0-9a-f]{40})[ \t]*(?=\r?\n|$)/m
// Audit comments are claims about authorization, never authorization itself.
const AUDIT_RE = /^PO INTEGRATION AUTHORIZATION/m
const FENCED_RE = /^(```|~~~)[^\n]*\r?\n[\s\S]*?^\1[^\S\n]*$/gm
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g

// Content inside fenced code blocks or HTML comments is not a visible,
// affirmative statement — strip it before matching. Unterminated fences or
// comments swallow everything after them (fail closed).
function stripNonContent(body) {
  let s = body.replace(HTML_COMMENT_RE, '\n').replace(FENCED_RE, '\n')
  const openers = [s.search(/^(?:```|~~~)/m), s.indexOf('<!--')].filter((i) => i !== -1)
  if (openers.length > 0) s = s.slice(0, Math.min(...openers))
  return s
}

export function parseAuthorizationArtifact(body) {
  if (typeof body !== 'string') return null
  const m = BLOCK_RE.exec(stripNonContent(body))
  if (!m) return null
  return { pr: Number(m[1]), head: m[2] }
}

// Cross-checks the live PR (as returned by `gh api repos/<repo>/pulls/<n>`)
// against what the operator claims to merge. Empty array = consistent.
export function crossCheckPullRequest(pr, { prNumber, headSha } = {}) {
  if (!pr || typeof pr !== 'object') return ['pull request data is missing or invalid']
  const reasons = []
  if (pr.number !== prNumber) {
    reasons.push(`live PR number ${pr.number} does not match expected #${prNumber}`)
  }
  if (pr.merged === true || pr.merged_at) {
    reasons.push('PR is already merged — the gate never validates a completed merge retroactively')
  }
  if (pr.state !== 'open') {
    reasons.push(`PR state "${pr.state}" is not open`)
  }
  if (pr.head?.sha !== headSha) {
    reasons.push(
      `live PR head ${pr.head?.sha} does not match supplied head ${headSha} — stale or wrong head argument`
    )
  }
  return reasons
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

function ghApi(args) {
  const res = spawnSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (res.error || res.status !== 0) {
    fail(`gh api failed: ${res.stderr?.trim() || res.error?.message || 'unknown error'}`)
  }
  return res.stdout
}

function main() {
  const [prArg, headArg] = process.argv.slice(2)
  const prNumber = Number(prArg)
  if (!Number.isInteger(prNumber) || prNumber <= 0 || !/^[0-9a-f]{40}$/.test(headArg ?? '')) {
    fail('Usage: node scripts/g2-authorization-gate.mjs <pr-number> <head-sha-40-hex>')
  }

  // The supplied head is the operator's intent; the live PR is the machine
  // truth. Both must agree before any artifact is even considered.
  let pullRequest
  try {
    pullRequest = JSON.parse(ghApi([`repos/${REPO}/pulls/${prNumber}`]))
  } catch {
    fail('could not parse gh api pull-request output')
  }
  const prReasons = crossCheckPullRequest(pullRequest, { prNumber, headSha: headArg })
  if (prReasons.length > 0) {
    fail(`live PR #${prNumber} does not match the requested merge state`, prReasons)
  }

  let comments
  try {
    comments = ghApi([`repos/${REPO}/issues/${prNumber}/comments`, '--paginate', '--jq', '.[]'])
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

// Compare against the realpath of argv[1]: Node resolves the ESM entry URL to
// its physical path, so a symlinked invocation path would otherwise skip main()
// and exit 0 — a silent fail-open. Any resolution error keeps the guard false.
function isCliEntry() {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
}

if (isCliEntry()) main()
