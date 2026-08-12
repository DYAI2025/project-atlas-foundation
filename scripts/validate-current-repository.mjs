// Current-state consistency validation for DYAI2025/project-atlas-foundation.
// Zero dependencies; run with: node scripts/validate-current-repository.mjs
// Exit 0 + "VALIDATION PASSED" when consistent, exit 1 with findings otherwise.
import { readFile, access } from 'node:fs/promises'

const failures = []
const ok = []

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function check(name, condition, detail = '') {
  if (condition) ok.push(name)
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const REQUIRED_FILES = [
  'README.md',
  'CODEOWNERS',
  'import-provenance.json',
  'build-manifest.json',
  'architecture-decision.json',
  'architecture/adr/ADR-0001-canonical-store-and-gbrain-projection.md',
  'architecture/approval-boundary.md',
  'config/project-registry.json',
  // ATLAS-22 Slice 2: the published gbrain-read contract is a first-class repository
  // artifact, so its absence must be a repository finding. Deliberately existence
  // only — schema correctness, identifier semantics, project/source scope, canonical
  // ordering and graph integrity stay owned by src/gbrain-read-contract/** and
  // test/gbrain-read-contract.test.mjs and are NOT duplicated here.
  'contracts/gbrain-read/v1/request.schema.json',
  'contracts/gbrain-read/v1/response.schema.json',
  'contracts/gbrain-read/v1/graph-snapshot.schema.json',
  'docs/repository-assessment.md',
  'docs/governance/repository-roles.md',
  'docs/governance/blockers.md',
  'docs/policies/pr-rules.md',
  'docs/plans/2026-08-06-atlas-sprint-1-foundation.md',
  'docs/historical-import/README-foundation.md',
  'reports/release-decision.json',
  'reports/validation-report.md',
  'reports/historical-import/project-atlas-foundation-checksums.txt',
  'reports/historical-import/provenance.json',
  'third_party/upstreams.lock.json',
  '.github/workflows/ci.yml',
  '.claude/skills/atlas-gated-pr/SKILL.md',
  'scripts/g2-authorization-gate.mjs',
  'test/g2-authorization-gate.test.mjs',
  'security/secret-scan.pin.json',
  'scripts/secret-scan.mjs',
  'test/secret-scan.test.mjs',
  '.github/workflows/secret-scan.yml'
]

for (const f of REQUIRED_FILES) {
  check(`file exists: ${f}`, await exists(f))
}

// 1) build-manifest: no stale open repository decision, current repo/branch, marked import
const manifest = JSON.parse(await readFile('build-manifest.json', 'utf8'))
check(
  'build-manifest repository points at canonical repo',
  manifest.repository.includes('DYAI2025/project-atlas-foundation') &&
    !manifest.repository.includes('/mnt/data') &&
    !manifest.repository.includes('gbrain-atlas')
)
check(
  'build-manifest target_branch is the working branch',
  manifest.target_branch === 'feat/ATLAS-13-sprint-1-foundation'
)
check(
  'build-manifest marks imported origin evidence',
  manifest.historical_import?.status === 'historical_import_evidence'
)
check(
  'build-manifest has no open migration-decision risk',
  !(manifest.known_risks ?? []).some((r) => /migration decision/i.test(r))
)
check(
  'build-manifest authorization reflects the granted Owner order',
  !/not authorized/i.test(manifest.authorization_evidence) &&
    /Owner decision 2026-08-06/.test(manifest.authorization_evidence)
)
check(
  'build-manifest rollback covers remote, Jira and Confluence mutations',
  /PR #1/.test(manifest.rollback.join(' ')) &&
    /Jira/.test(manifest.rollback.join(' ')) &&
    /Confluence/.test(manifest.rollback.join(' '))
)

// 2) no canonical reference to gbrain-atlas as target remote
const roles = await readFile('docs/governance/repository-roles.md', 'utf8')
const provenance = JSON.parse(await readFile('import-provenance.json', 'utf8'))
check(
  'import provenance names the canonical repository',
  provenance.canonical_repository === 'DYAI2025/project-atlas-foundation' &&
    provenance.history_migrated === false
)
check(
  'repository roles: canonical / read-only legacy / deprecated snapshot',
  /project-atlas-foundation/.test(roles) &&
    /kanonisch/i.test(roles) &&
    /gbrain-atlas/.test(roles) &&
    /read-only/i.test(roles) &&
    /Gbrain-vps/.test(roles) &&
    /deprecated/i.test(roles) &&
    roles.includes('aea0fb0b934780a205db92066786b265de0de22a')
)

// 3) no /mnt/data claims presented as current state
const release = await readFile('reports/release-decision.json', 'utf8')
check('release decision contains no /mnt/data claim', !release.includes('/mnt/data'))
check(
  'release decision has no open remote-migration blocker',
  !/migration decision/i.test(release)
)
const releaseJson = JSON.parse(release)
check(
  'release decision separates foundation maturity from merge readiness',
  typeof releaseJson.foundation_maturity === 'string' &&
    typeof releaseJson.merge_readiness === 'string' &&
    releaseJson.repository?.canonical === 'DYAI2025/project-atlas-foundation' &&
    releaseJson.repository?.push_verified === true &&
    release.includes('BLK-ATLAS-13-01')
)

// 4) validation report split into historical vs current
const valReport = await readFile('reports/validation-report.md', 'utf8')
check(
  'validation report has historical and current sections',
  valReport.includes('## Historical imported validation') &&
    valReport.includes('## Current canonical repository validation')
)

// 5) historical evidence marked as historical
check(
  'old checksums path removed',
  !(await exists('reports/project-atlas-foundation-checksums.txt'))
)
const histProv = JSON.parse(
  await readFile('reports/historical-import/provenance.json', 'utf8')
)
check(
  'historical checksums provenance is complete',
  histProv.status === 'historical_import_evidence' &&
    histProv.source_commit === '004787b179835eb359efcade393a65b3c8f62203'
)
const histReadme = await readFile('docs/historical-import/README-foundation.md', 'utf8')
check(
  'historical README is marked and free of pending-remote / dead-handoff claims',
  histReadme.includes('historical_import_evidence') &&
    !histReadme.includes('](docs/delivery/github-handoff.md)') &&
    !/remote decision pending/i.test(histReadme)
)

// 6) plan covers exactly the eight delivery tickets plus exactly one sprint enabler.
// Sprint 370 carries ATLAS-55 as an enabler/impediment, not as a ninth delivery outcome.
// The two sets are kept strictly separate; neither check is a loosened ticket check.
const plan = await readFile('docs/plans/2026-08-06-atlas-sprint-1-foundation.md', 'utf8')
const ticketSections = [...plan.matchAll(/^## ATLAS-(\d+) — (.*)$/gm)].map((m) => ({
  id: m[1],
  isEnabler: /Sprint Enabler/.test(m[2]),
}))
const deliveryTickets = ticketSections
  .filter((t) => !t.isEnabler)
  .map((t) => t.id)
  .sort()
const enablerTickets = ticketSections
  .filter((t) => t.isEnabler)
  .map((t) => t.id)
  .sort()
check(
  'plan contains exactly the eight delivery tickets',
  JSON.stringify(deliveryTickets) ===
    JSON.stringify(['11', '12', '13', '15', '21', '22', '23', '24']),
  `found: ${deliveryTickets.join(',') || 'none'}`
)
check(
  'plan contains exactly one sprint enabler: ATLAS-55',
  JSON.stringify(enablerTickets) === JSON.stringify(['55']),
  `found: ${enablerTickets.join(',') || 'none'}`
)

// 7) PRODUKTMAN mappings are correct (EYT/PLUM are Jira keys, never space keys)
const spaceKeys = [...plan.matchAll(/"confluence_space_key":\s*"([^"]+)"/g)].map((m) => m[1])
check(
  'every confluence_space_key in the plan is PRODUKTMAN',
  spaceKeys.length >= 3 && spaceKeys.every((k) => k === 'PRODUKTMAN'),
  `found: ${spaceKeys.join(',') || 'none'}`
)
check(
  'plan maps EasyTree/Plumbline roots with PRODUKTMAN',
  plan.includes('5505026') && plan.includes('7503873')
)

// 8) dead github-handoff reference only allowed inside the marked import manifest
for (const f of ['README.md', 'docs/governance/repository-roles.md', 'reports/release-decision.json', 'reports/validation-report.md']) {
  const content = await readFile(f, 'utf8')
  check(`no dead github-handoff reference in ${f}`, !content.includes('github-handoff'))
}

// 9) G2 authorization gate is present, fail-closed and process-bound (ATLAS-56)
const skill = await readFile('.claude/skills/atlas-gated-pr/SKILL.md', 'utf8')
check(
  'skill references the G2 authorization gate and artifact marker (textual invariant)',
  skill.includes('g2-authorization-gate.mjs') && skill.includes('G2-AUTHORIZATION')
)
const prRules = await readFile('docs/policies/pr-rules.md', 'utf8')
const prRulesFlat = prRules.replace(/\s+/g, ' ')
check('pr-rules define the G2-AUTHORIZATION artifact schema', prRules.includes('G2-AUTHORIZATION'))
check(
  'pr-rules prohibit agent-created authorization artifacts',
  prRules.includes('niemals selbst erzeugen')
)
const gateSrc = await readFile('scripts/g2-authorization-gate.mjs', 'utf8')
check(
  'gate fails closed with an explicit MISSING verdict',
  gateSrc.includes('G2 AUTHORIZATION MISSING')
)

// 10) Reflect 2026-08-09 process hardening is bound into skill and policy
check(
  'skill contains the idempotency pre-check guardrail',
  skill.includes('Idempotency pre-check')
)
check(
  'skill forbids silently skipped reconciliation pages',
  skill.includes('never silently skipped')
)
check(
  'skill binds plan-file hygiene',
  skill.includes('Plan-file hygiene')
)
check(
  'pr-rules require decision provenance with citable artifacts',
  prRules.includes('Entscheidungs-Provenienz') &&
    prRules.includes('niemals aus Plan-Entwürfen')
)

// 11) Reflect 2026-08-09 §3 correction: an explicit PO order is materializable,
//     under conditions, without weakening the anti-inference core
check(
  'pr-rules allow controlled materialization of an explicit PO order',
  prRules.includes('Kontrollierte Materialisierung') &&
    prRulesFlat.includes('die Erstellung des Artefakts ist dort ausdrücklich autorisiert')
)
check(
  'controlled materialization requires read-after-write before citation',
  prRules.includes('Read-after-Write') &&
    prRulesFlat.includes('Erst das erfolgreich zurückgelesene Artefakt darf anschließend')
)
check(
  'G2 authorization artifact stays carved out of controlled materialization',
  prRulesFlat.includes('jede Aussage über eine bereits erteilte Merge- oder Integrationsfreigabe') &&
    prRulesFlat.includes('ausschließlich vom menschlichen PO selbst erzeugt') &&
    prRulesFlat.includes('auch nicht auf ausdrückliche Anweisung im Auftrag')
)
check(
  'anti-inference core sentences still present',
  prRules.includes('niemals aus Plan-Entwürfen') &&
    prRules.includes('OFFEN — PO-Entscheidung ausstehend')
)
check(
  'materialized artifacts must be self-marked as agent-materialized',
  prRulesFlat.includes('nicht vom PO selbst verfasst')
)

// 12) ATLAS-57: the two accepted controlled-materialization conditions that carried
//     no policy-side regression binding yet. Condition 7 (idempotency semantics) was
//     bound only in the Skill, not in the policy; Condition 8 was bound only by its
//     disclaimer half, so a rewrite could drop the marking and the reader
//     distinguishability while the existing check stayed green.
check(
  'pr-rules bind controlled materialization to the idempotency pre-check (Bedingung 7)',
  prRulesFlat.includes('Idempotenz-Vorprüfung') &&
    prRulesFlat.includes('verifiziert statt dupliziert') &&
    prRulesFlat.includes('wird nicht überschrieben')
)
check(
  'pr-rules require materialized artifacts to name their agent authorship (Bedingung 8)',
  prRulesFlat.includes('materialisiert durch den ausführenden Agenten') &&
    prRulesFlat.includes('unterscheiden können')
)

// 13) ATLAS-58: the writer registry is a mandatory repository artifact. This binding is
//     deliberately repository-level only — existence (REQUIRED_FILES), parseability, the
//     root project_id and the exact V1 project-id set. The deep registry contract
//     (schema_version, description wording, jira_key/root_page_id mappings, space,
//     allowed_writers, approval_workflow, status, duplicate/ambiguity rules, selector and
//     routing behaviour) stays owned by src/registry/resolve.mjs and
//     test/registry-resolve.test.mjs and is NOT duplicated here.
//     The read is guarded so a missing or malformed registry becomes a validator finding
//     instead of an uncaught ENOENT/SyntaxError that would skip the VALIDATION FAILED
//     verdict entirely. Guarding the remaining unguarded reads is ATLAS-64, not this slice.
let registry = null
let registryReadError = ''
try {
  registry = JSON.parse(await readFile('config/project-registry.json', 'utf8'))
} catch (error) {
  registryReadError = error.message
}
check(
  'writer registry parses as a JSON object',
  registry !== null && typeof registry === 'object' && !Array.isArray(registry),
  registryReadError || 'registry root must be a JSON object'
)
check(
  'writer registry root project_id is ATLAS',
  registry?.project_id === 'ATLAS',
  `found: ${registry?.project_id ?? 'none'}`
)
// Keyed by the project_id set only, and sorted so the order of `projects` carries no
// meaning — a missing, extra or duplicated project id all fail closed here.
const registryProjectIds = Array.isArray(registry?.projects)
  ? registry.projects.map((p) => p?.project_id).toSorted()
  : []
check(
  'writer registry contains exactly the three V1 projects',
  JSON.stringify(registryProjectIds) === JSON.stringify(['ATLAS', 'EASYTREE', 'PLUMBLINE']),
  `found: ${registryProjectIds.join(',') || 'none'}`
)

// 14) ATLAS-23 SECRET_SCAN_ONLY: the secret-scan gate is a mandatory repository
//     artifact. Presence + binding checks only — scan correctness is owned by the
//     gate's runtime self-test and test/secret-scan.test.mjs, not duplicated here.
let pin = null
let pinReadError = ''
try {
  pin = JSON.parse(await readFile('security/secret-scan.pin.json', 'utf8'))
} catch (error) {
  pinReadError = error.message
}
check(
  'secret-scan pin: parses as a JSON object',
  pin !== null && typeof pin === 'object' && !Array.isArray(pin),
  pinReadError || 'pin root must be a JSON object'
)
check(
  'secret-scan pin: role marker',
  pin?.role === 'CI SECURITY TOOL — NOT PRODUCT RUNTIME UPSTREAM'
)
check(
  'secret-scan pin: version 8.30.1',
  pin?.version === '8.30.1' && pin?.expectedVersionOutput === '8.30.1'
)
check(
  'secret-scan pin: full-history log-opts',
  pin?.logOpts === '--all --full-history --root -m'
)
check(
  'secret-scan pin: linux digest shape',
  /^[0-9a-f]{64}$/.test(pin?.assets?.['linux-x64']?.sha256 ?? '')
)
check(
  'secret-scan pin: darwin digest shape',
  /^[0-9a-f]{64}$/.test(pin?.assets?.['darwin-arm64']?.sha256 ?? '')
)
const wf = await readFile('.github/workflows/secret-scan.yml', 'utf8')
check('secret-scan workflow: job id secret-scan', /^\s{2}secret-scan:/m.test(wf))
check('secret-scan workflow: full-history checkout', wf.includes('fetch-depth: 0'))
check(
  'secret-scan workflow: contents read only',
  wf.includes('permissions:\n  contents: read')
)
const wrapper = await readFile('scripts/secret-scan.mjs', 'utf8')
check(
  'secret-scan wrapper: pinned traversal',
  wrapper.includes('--all --full-history --root -m') || wrapper.includes('pin.logOpts')
)
check(
  'secret-scan wrapper: self-test stage present',
  wrapper.includes('SELF-TEST PASSED')
)
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
check(
  'package.json: secret-scan script',
  pkg.scripts?.['secret-scan'] === 'node scripts/secret-scan.mjs'
)
check(
  'pr-rules: secret-scan named as required context',
  prRules.includes('`secret-scan`')
)
check('atlas-gated-pr skill: waits for secret-scan context', skill.includes('secret-scan'))

if (failures.length > 0) {
  console.error('VALIDATION FAILED')
  for (const f of failures) console.error(' ✗', f)
  process.exit(1)
}
console.log('VALIDATION PASSED')
for (const o of ok) console.log(' ✓', o)
