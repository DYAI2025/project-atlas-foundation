// Current-state consistency validation for DYAI2025/project-atlas-foundation.
// Zero dependencies; run with: node scripts/validate-current-repository.mjs
// Exit 0 + "VALIDATION PASSED" when consistent, exit 1 with findings otherwise.
import { readFile, access, stat } from 'node:fs/promises'

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

// Stricter than exists(): a directory carrying the declared name must not satisfy a
// declared file reference. Guarded like exists(), so an unreadable path is a finding.
async function isFile(path) {
  try {
    return (await stat(path)).isFile()
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
  '.github/workflows/secret-scan.yml',
  // ATLAS-39: the workspace shell, its design system, its committed read
  // request and its visual baseline are first-class repository artifacts, so a
  // missing one is a repository finding. Deliberately existence only — the
  // shell contract (landmarks, tokens, reduced motion, focus treatment, the
  // no-fallback rule) is owned by test/atlas39-shell.test.mjs and the visual
  // baseline by test/atlas39-visual.test.mjs, and neither is duplicated here.
  'viewer/atlas39/index.html',
  'viewer/atlas39/tokens.css',
  'viewer/atlas39/stage.css',
  'viewer/atlas39/shell.css',
  'viewer/atlas39/app.mjs',
  'viewer/atlas39/core/view-model.mjs',
  'viewer/atlas39/core/layout.mjs',
  'viewer/atlas39/core/render-svg.mjs',
  'viewer/atlas39/core/stage-mount.mjs',
  'config/atlas39-read-request.json',
  'scripts/atlas39/render-golden.mjs',
  'test/atlas39-shell.test.mjs',
  'test/atlas39-stage-mount.test.mjs',
  'test/atlas39-visual.test.mjs',
  'test/golden/atlas39-stage-overview.svg',
  'test/golden/atlas39-stage-focus.svg',

  // ATLAS-40 slice 1: the WebGL renderer that replaced render-svg.mjs on the
  // browser success path, plus the pure modules the swap needed. The behaviour
  // is owned by the atlas40-* suites and is not duplicated here.
  'viewer/atlas39/core/render-webgl.mjs',
  'viewer/atlas39/core/scene.mjs',
  'viewer/atlas39/core/scene-guard.mjs',
  'viewer/atlas39/core/transform.mjs',
  'viewer/atlas39/core/search.mjs',
  'docs/atlas-40-webgl-renderer.md',
  'test/atlas40-render-webgl.test.mjs',
  'test/atlas40-scene.test.mjs',
  'test/atlas40-scene-guard.test.mjs',
  'test/atlas40-transform.test.mjs',
  'test/atlas40-shell.test.mjs',
  'docs/atlas-39-workspace-shell.md'
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

// 15) ATLAS-14 ARCH_DOC_PARITY: architecture-decision.json declares its architecture
//     diagrams in `diagram_paths`. A declared-but-absent diagram makes the approved
//     architecture record internally inconsistent and unreviewable, so every declared
//     path is dereferenced here instead of being taken on faith.
//     Deliberately generic: the check reads whatever the decision declares rather than
//     re-listing the current filenames in REQUIRED_FILES, so renaming or adding a
//     diagram cannot silently bypass the parity gate.
//     Deliberately parity-only — the architecture SEMANTICS of the diagrams (lane
//     separation, gbrain-as-derived-projection, no UI stack selection, legacy handling)
//     stay owned by test/architecture-diagrams.test.mjs and are NOT duplicated here.
//     The read is guarded so a missing or malformed decision file becomes a validator
//     finding instead of an uncaught ENOENT/SyntaxError that would skip the
//     VALIDATION FAILED verdict entirely. Guarding the remaining unguarded reads in this
//     script is ATLAS-64, not this slice; no existing read is widened here.
let decision = null
let decisionReadError = ''
try {
  decision = JSON.parse(await readFile('architecture-decision.json', 'utf8'))
} catch (error) {
  decisionReadError = error.message
}
check(
  'architecture decision parses as a JSON object',
  decision !== null && typeof decision === 'object' && !Array.isArray(decision),
  decisionReadError || 'architecture-decision.json root must be a JSON object'
)
const declaredDiagrams = decision?.diagram_paths
check(
  'architecture decision declares diagram_paths as a non-empty array',
  Array.isArray(declaredDiagrams) && declaredDiagrams.length > 0,
  `found: ${JSON.stringify(declaredDiagrams) ?? 'none'}`
)
// Each declared entry is checked in two independent halves so neither can mask the
// other: first that it is a usable repository-relative reference at all, then that it
// actually resolves. An unusable entry is a finding in its own right and is never
// silently downgraded to "nothing to dereference".
for (const [index, declared] of (Array.isArray(declaredDiagrams)
  ? declaredDiagrams
  : []
).entries()) {
  const label = `diagram_paths[${index}]`
  const usable =
    typeof declared === 'string' &&
    declared.trim() !== '' &&
    !declared.startsWith('/') &&
    !declared.split('/').includes('..')
  check(
    `${label} is a non-empty repository-relative path`,
    usable,
    `found: ${JSON.stringify(declared)}`
  )
  if (!usable) continue
  check(`${label} resolves to an existing file: ${declared}`, await isFile(declared))
}

// 16) ATLAS-39 WORKSPACE_SHELL: the run command a developer or the PO is told to
//     use must be the command the repository actually ships, and the visual
//     baseline's provenance claim must be the same in the runbook and in the
//     test that enforces it. Both are cross-artifact consistency questions that
//     no single test file can answer, which is why they live here rather than
//     being duplicated into the ATLAS-39 suites.
//     Reads are guarded so a missing or malformed file becomes a finding instead
//     of an uncaught error that would skip the VALIDATION FAILED verdict.
let atlas39Package = null
let atlas39PackageError = ''
try {
  atlas39Package = JSON.parse(await readFile('package.json', 'utf8'))
} catch (error) {
  atlas39PackageError = error.message
}
const atlas39Scripts = atlas39Package?.scripts ?? {}
check(
  'package.json declares the ATLAS-39 workspace commands',
  typeof atlas39Scripts['atlas39:serve'] === 'string' &&
    typeof atlas39Scripts['atlas39:golden'] === 'string' &&
    typeof atlas39Scripts['atlas39:visual'] === 'string',
  atlas39PackageError || `found: ${JSON.stringify(Object.keys(atlas39Scripts))}`
)
check(
  'atlas39:serve runs the ATLAS-39 viewer against the committed accepted evidence',
  typeof atlas39Scripts['atlas39:serve'] === 'string' &&
    atlas39Scripts['atlas39:serve'].includes('--viewer atlas39') &&
    atlas39Scripts['atlas39:serve'].includes('--dir docs/evidence/atlas-65') &&
    atlas39Scripts['atlas39:serve'].includes('--request config/atlas39-read-request.json'),
  `found: ${JSON.stringify(atlas39Scripts['atlas39:serve'])}`
)
// The ATLAS-65 pilot must keep its own untouched entry point: ATLAS-39 reuses
// the server, it does not repurpose the accepted command.
check(
  'the ATLAS-65 serve command is unchanged by ATLAS-39',
  atlas39Scripts['atlas65:serve'] === 'node scripts/atlas65/serve.mjs',
  `found: ${JSON.stringify(atlas39Scripts['atlas65:serve'])}`
)

let atlas39Request = null
let atlas39RequestError = ''
try {
  atlas39Request = JSON.parse(await readFile('config/atlas39-read-request.json', 'utf8'))
} catch (error) {
  atlas39RequestError = error.message
}
check(
  'the committed ATLAS-39 read request is scoped to project ATLAS by project_id',
  atlas39Request?.contract_version === '1.0.0' &&
    atlas39Request?.operation === 'read_graph' &&
    atlas39Request?.project?.selector_kind === 'project_id' &&
    atlas39Request?.project?.selector_value === 'ATLAS',
  atlas39RequestError || `found: ${JSON.stringify(atlas39Request?.project)}`
)

// The runbook states which snapshot the visual baseline was rendered from; the
// visual test enforces it. If those two ever name different digests, one of them
// is lying to the reader.
let atlas39Runbook = ''
let atlas39VisualTest = ''
let atlas39DigestError = ''
try {
  atlas39Runbook = await readFile('docs/atlas-39-workspace-shell.md', 'utf8')
  atlas39VisualTest = await readFile('test/atlas39-visual.test.mjs', 'utf8')
} catch (error) {
  atlas39DigestError = error.message
}
// Both sides are bound to their own explicit label rather than to "the first
// 64-hex run in the file": a digest mentioned anywhere else in either document
// must not be able to satisfy — or to break — this check.
const runbookDigest = atlas39Runbook.match(/\|\s*Snapshot sha256\s*\|\s*`([0-9a-f]{64})`\s*\|/)?.[1] ?? null
const visualTestDigest = atlas39VisualTest.match(/ACCEPTED_SNAPSHOT_SHA256\s*=\s*'([0-9a-f]{64})'/)?.[1] ?? null
check(
  'the runbook and the visual test pin the same accepted-snapshot digest',
  runbookDigest !== null && runbookDigest === visualTestDigest,
  atlas39DigestError || `runbook: ${runbookDigest} / visual test: ${visualTestDigest}`
)

// 17) ATLAS-40 RENDERER SWAP: the browser success path must actually be the
//     WebGL renderer. The behavioural proof lives in the atlas40-* suites and in
//     the headed acceptance run; what is checked here is the structural claim
//     the documentation makes, so the two cannot drift apart silently.
let atlas40App = ''
let atlas40Doc = ''
let atlas40SceneTest = ''
let atlas40Error = ''
try {
  atlas40App = await readFile('viewer/atlas39/app.mjs', 'utf8')
  atlas40Doc = await readFile('docs/atlas-40-webgl-renderer.md', 'utf8')
  atlas40SceneTest = await readFile('test/atlas40-scene.test.mjs', 'utf8')
} catch (error) {
  atlas40Error = error.message
}

check(
  'the workspace shell renders the graph with the WebGL renderer',
  atlas40App.includes("from './core/render-webgl.mjs'"),
  atlas40Error || 'app.mjs does not import core/render-webgl.mjs'
)
// The SVG renderer is retained for the golden geometry gate, so "it still exists"
// is not the question. The question is whether it is still what the browser draws.
check(
  'the superseded SVG renderer is no longer on the shell path',
  atlas40App !== '' &&
    !atlas40App.includes("from './core/render-svg.mjs'") &&
    !atlas40App.includes("from './core/stage-mount.mjs'"),
  atlas40Error || 'app.mjs still imports the ATLAS-39 SVG renderer or its mount guard'
)
check(
  'render-svg.mjs states that it is no longer the browser renderer',
  (await readFile('viewer/atlas39/core/render-svg.mjs', 'utf8').catch(() => '')).includes(
    'SUPERSEDED AS THE BROWSER RENDERER BY ATLAS-40'
  )
)
// A third copy of the accepted digest: the WebGL scene test must be verified
// against the same snapshot as the golden gate and the runbook.
const atlas40SceneDigest = atlas40SceneTest.match(/ACCEPTED_SNAPSHOT_SHA256\s*=\s*'([0-9a-f]{64})'/)?.[1] ?? null
check(
  'the ATLAS-40 scene test pins the same accepted-snapshot digest',
  atlas40SceneDigest !== null && atlas40SceneDigest === runbookDigest,
  atlas40Error || `scene test: ${atlas40SceneDigest} / runbook: ${runbookDigest}`
)
check(
  'the ATLAS-40 runbook records the delivered slice and its deferred scope',
  atlas40Doc.includes('Slice 1') && /##\s*Not delivered by slice 1/i.test(atlas40Doc),
  atlas40Error || 'docs/atlas-40-webgl-renderer.md does not state its slice boundary'
)
check(
  'README points at the ATLAS-40 renderer runbook',
  (await readFile('README.md', 'utf8').catch(() => '')).includes('docs/atlas-40-webgl-renderer.md')
)
check(
  'README points at the ATLAS-39 run command and runbook',
  (await readFile('README.md', 'utf8').catch(() => '')).includes('npm run atlas39:serve')
)

if (failures.length > 0) {
  console.error('VALIDATION FAILED')
  for (const f of failures) console.error(' ✗', f)
  process.exit(1)
}
console.log('VALIDATION PASSED')
for (const o of ok) console.log(' ✓', o)
