import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ATLAS-12 closeout evidence. This test is the ONLY consumer of the snapshot.
// The snapshot is historical acceptance evidence, never runtime or routing input.

const EVIDENCE_PATH = fileURLToPath(
  new URL('../docs/evidence/atlas-12-page-tree-snapshot.json', import.meta.url)
)

const EXPECTED_ROOT = '14778372'
const EXPECTED_BLUEPRINT = '14647297'
const EXPECTED_ROOT_TITLE = 'ATLAS Single Source of Truth'
const EXPECTED_BLUEPRINT_TITLE = 'ATLAS Seitenbaum 00–18'

// The exact page tree observed under root 14778372 at 2026-08-09T17:50:48Z.
// Frozen regression evidence for a historical artifact — NOT runtime
// configuration and NOT a second source of truth. Confluence stays canonical;
// if Confluence changes, this evidence and these expectations do not.
// Tuples are [number, page_id, title]. Titles use EN DASH (U+2013).
const EXPECTED_TREE = [
  ['00', '15138817', '00 – Project Home and Executive Brief'],
  ['01', '15171585', '01 – Product Vision, Users, Outcomes and Scope'],
  ['02', '14680066', '02 – Source of Truth, Governance and Decision Rights'],
  ['03', '15204353', '03 – Current State, Legacy Findings and Problem Statement'],
  ['04', '15073290', '04 – Target Architecture and System Context'],
  ['05', '14614530', '05 – Canonical Data Model and Semantics'],
  ['06', '15237121', '06 – Ingestion, Normalization and Provenance Pipeline'],
  ['07', '15269889', '07 – Embeddings, Retrieval and Search Quality'],
  ['08', '15302657', '08 – Knowledge Graph, Temporal Semantics and Evidence'],
  ['09', '15237147', '09 – MCP Access, Routing and Project Isolation'],
  ['10', '14385164', '10 – Obsidian Projection and Knowledge UX'],
  ['11', '15335425', '11 – Premium Graph UI Specification'],
  ['12', '15368193', '12 – Security, Data Classification and Compliance Guardrails'],
  ['13', '15040514', '13 – Repository Assessment and Technical Reuse Strategy'],
  ['14', '15171611', '14 – Delivery Model, Program Increment and Sprint Plan'],
  ['15', '14778401', '15 – Backlog Structure, Epics and Jira Mapping'],
  ['16', '15400961', '16 – Migration, Archive, Backup and Recovery'],
  ['17', '14548994', '17 – Test Strategy, Release Gates and Evidence Ledger'],
  ['18', '14581771', '18 – Change Log and Session Handoffs']
]
const EXPECTED_NUMBERS = EXPECTED_TREE.map(([number]) => number)
const EXPECTED_CHILD_COUNT = EXPECTED_NUMBERS.length

function loadEvidence() {
  return JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'))
}

// JSON.parse already yields a fresh object graph on every call, so this is a
// plain re-read, not a deep copy of shared state.
function freshEvidence() {
  return loadEvidence()
}

// Test-local validator. Intentionally NOT a production module: the evidence file
// must never acquire a runtime consumer.
function validateEvidence(doc) {
  const errors = []

  if (doc.jira_issue !== 'ATLAS-12') errors.push('jira_issue must be ATLAS-12')
  if (doc.evidence_type !== 'historical_acceptance_snapshot') {
    errors.push('evidence_type must be historical_acceptance_snapshot')
  }
  if (doc.canonical !== false) errors.push('canonical must be false')
  if (doc.not_runtime_input !== true) errors.push('not_runtime_input must be true')
  if (doc.source_of_truth !== 'Confluence') errors.push('source_of_truth must be Confluence')
  if (doc.space_key !== 'PRODUKTMAN') errors.push('space_key must be PRODUKTMAN')
  if (doc.root_page_id !== EXPECTED_ROOT) errors.push(`root_page_id must be ${EXPECTED_ROOT}`)
  if (doc.root_title !== EXPECTED_ROOT_TITLE) {
    errors.push(`root_title must be ${JSON.stringify(EXPECTED_ROOT_TITLE)}`)
  }
  if (typeof doc.observed_at !== 'string' || doc.observed_at.length === 0) {
    errors.push('observed_at must be a non-empty string')
  }
  if (typeof doc.capture_method !== 'string' || doc.capture_method.length === 0) {
    errors.push('capture_method must be a non-empty string')
  }
  if (!Array.isArray(doc.source_references) || doc.source_references.length === 0) {
    errors.push('source_references must be a non-empty array')
  }
  if (typeof doc.notice !== 'string' || doc.notice.length === 0) {
    errors.push('notice must be a non-empty string')
  }

  const children = doc.numbered_children
  if (!Array.isArray(children)) {
    errors.push('numbered_children must be an array')
    return errors
  }
  if (children.length !== EXPECTED_CHILD_COUNT) {
    errors.push(
      `numbered_children must contain exactly ${EXPECTED_CHILD_COUNT} entries, got ${children.length}`
    )
  }

  const numbers = children.map((c) => c.number)
  for (const expected of EXPECTED_NUMBERS) {
    if (!numbers.includes(expected)) errors.push(`missing numbered child ${expected}`)
  }
  for (const n of numbers) {
    if (!EXPECTED_NUMBERS.includes(n)) errors.push(`unexpected child number ${n}`)
  }

  const ids = []
  for (const child of children) {
    if (typeof child.page_id !== 'string' || child.page_id.length === 0) {
      errors.push(`child ${child.number} has empty page_id`)
      continue
    }
    if (typeof child.title !== 'string' || child.title.length === 0) {
      errors.push(`child ${child.number} has empty title`)
    }
    // A transcription slip that pairs number "07" with title "08 – …" would keep
    // every other invariant intact, so the prefix is checked explicitly.
    if (typeof child.title === 'string' && !child.title.startsWith(`${child.number} `)) {
      errors.push(`child ${child.number} title does not start with its number`)
    }
    if (ids.includes(child.page_id)) errors.push(`duplicate page_id ${child.page_id}`)
    ids.push(child.page_id)
  }

  // Exact historical identity. The structural rules above cannot catch a
  // unique-but-wrong ID or a correctly-prefixed-but-wrong title.
  for (const [number, pageId, title] of EXPECTED_TREE) {
    const child = children.find((c) => c.number === number)
    // An entirely absent number is already reported as a missing child;
    // do not double-report it as an identity mismatch.
    if (!child) continue
    if (child.page_id !== pageId) {
      errors.push(`child ${number} page_id must be ${pageId}, got ${child.page_id}`)
    }
    if (child.title !== title) {
      errors.push(
        `child ${number} title must be ${JSON.stringify(title)}, got ${JSON.stringify(child.title)}`
      )
    }
  }

  const blueprint = doc.blueprint
  if (!blueprint || blueprint.page_id !== EXPECTED_BLUEPRINT) {
    errors.push(`blueprint.page_id must be ${EXPECTED_BLUEPRINT}`)
  } else if (ids.includes(blueprint.page_id)) {
    errors.push('blueprint must not also be one of the numbered children')
  }
  if (blueprint && blueprint.title !== EXPECTED_BLUEPRINT_TITLE) {
    errors.push(`blueprint.title must be ${JSON.stringify(EXPECTED_BLUEPRINT_TITLE)}`)
  }

  return errors
}

// --- positive: the real evidence file ---------------------------------------

test('evidence file is parseable JSON', () => {
  assert.doesNotThrow(() => loadEvidence(), 'evidence file must parse as JSON')
})

test('evidence file declares itself non-canonical historical evidence', () => {
  const doc = loadEvidence()
  assert.equal(doc.canonical, false)
  assert.equal(doc.not_runtime_input, true)
  assert.equal(doc.evidence_type, 'historical_acceptance_snapshot')
  assert.equal(doc.source_of_truth, 'Confluence')
  assert.match(doc.notice, /evidence, not the canonical page tree/i)
})

test('evidence file identifies its ATLAS-12 Confluence scope', () => {
  const doc = loadEvidence()
  assert.equal(doc.jira_issue, 'ATLAS-12')
  assert.equal(doc.space_key, 'PRODUKTMAN')
  assert.equal(doc.root_page_id, EXPECTED_ROOT)
})

test('evidence file carries capture provenance', () => {
  const doc = loadEvidence()
  assert.ok(doc.schema_version, 'schema_version present')
  assert.ok(doc.evidence_id, 'evidence_id present')
  assert.ok(doc.observed_at, 'observed_at present')
  assert.ok(doc.capture_method, 'capture_method present')
  assert.ok(
    Array.isArray(doc.source_references) && doc.source_references.length > 0,
    'source_references must be a non-empty array'
  )
})

test(`evidence file records exactly the ${EXPECTED_CHILD_COUNT} numbered children 00-18 with unique ids`, () => {
  const doc = loadEvidence()
  assert.equal(doc.numbered_children.length, EXPECTED_CHILD_COUNT)
  assert.deepEqual(
    doc.numbered_children.map((c) => c.number).sort(),
    [...EXPECTED_NUMBERS].sort()
  )
  for (const child of doc.numbered_children) {
    assert.equal(typeof child.page_id, 'string', `page_id for ${child.number} must be a string`)
    assert.ok(child.page_id.length > 0, `page_id for ${child.number} must be non-empty`)
    assert.equal(typeof child.title, 'string', `title for ${child.number} must be a string`)
    assert.ok(child.title.length > 0, `title for ${child.number} must be non-empty`)
    assert.ok(
      child.title.startsWith(`${child.number} `),
      `title for ${child.number} must start with its own number, got ${JSON.stringify(child.title)}`
    )
  }
  const ids = doc.numbered_children.map((c) => c.page_id)
  assert.equal(new Set(ids).size, EXPECTED_CHILD_COUNT, 'page ids are unique')
})

test('blueprint page is recorded and is not one of the numbered children', () => {
  const doc = loadEvidence()
  assert.equal(doc.blueprint.page_id, EXPECTED_BLUEPRINT)
  const ids = doc.numbered_children.map((c) => c.page_id)
  assert.equal(ids.includes(EXPECTED_BLUEPRINT), false)
})

test('evidence file matches the exact observed page tree', () => {
  const doc = loadEvidence()
  assert.deepEqual(
    doc.numbered_children.map((c) => [c.number, c.page_id, c.title]),
    EXPECTED_TREE,
    'numbered children must equal the exact observed tree, in order'
  )
  assert.equal(doc.root_page_id, EXPECTED_ROOT)
  assert.equal(doc.root_title, EXPECTED_ROOT_TITLE)
  assert.equal(doc.blueprint.page_id, EXPECTED_BLUEPRINT)
  assert.equal(doc.blueprint.title, EXPECTED_BLUEPRINT_TITLE)
})

test('the real evidence file passes the validator with zero errors', () => {
  assert.deepEqual(validateEvidence(loadEvidence()), [])
})

// --- negative: the four PO-mandated error paths, individually named ----------

test('rejects a duplicate page ID', () => {
  const doc = freshEvidence()
  doc.numbered_children[1].page_id = doc.numbered_children[0].page_id
  const errors = validateEvidence(doc)
  assert.ok(
    errors.some((e) => e.startsWith('duplicate page_id')),
    errors.join('; ')
  )
})

test('rejects a missing numbered child', () => {
  const doc = freshEvidence()
  const removed = doc.numbered_children.pop()
  const errors = validateEvidence(doc)
  assert.ok(errors.some((e) => e === `missing numbered child ${removed.number}`), errors.join('; '))
  assert.ok(
    errors.some((e) => e.includes(`exactly ${EXPECTED_CHILD_COUNT} entries`)),
    errors.join('; ')
  )
})

test('rejects canonical = true', () => {
  const doc = freshEvidence()
  doc.canonical = true
  const errors = validateEvidence(doc)
  assert.ok(errors.includes('canonical must be false'), errors.join('; '))
})

test('rejects a wrong root page', () => {
  const doc = freshEvidence()
  doc.root_page_id = '9999999'
  const errors = validateEvidence(doc)
  assert.ok(errors.includes(`root_page_id must be ${EXPECTED_ROOT}`), errors.join('; '))
})

// --- negative: one row per remaining validator branch -------------------------

const MUTATIONS = [
  {
    name: 'a wrong jira_issue',
    mutate: (d) => {
      d.jira_issue = 'ATLAS-13'
    },
    error: 'jira_issue must be ATLAS-12'
  },
  {
    name: 'a wrong evidence_type',
    mutate: (d) => {
      d.evidence_type = 'config'
    },
    error: 'evidence_type must be historical_acceptance_snapshot'
  },
  {
    name: 'not_runtime_input = false',
    mutate: (d) => {
      d.not_runtime_input = false
    },
    error: 'not_runtime_input must be true'
  },
  {
    name: 'a source_of_truth other than Confluence',
    mutate: (d) => {
      d.source_of_truth = 'gbrain'
    },
    error: 'source_of_truth must be Confluence'
  },
  {
    name: 'a wrong space_key',
    mutate: (d) => {
      d.space_key = 'OTHERSPACE'
    },
    error: 'space_key must be PRODUKTMAN'
  },
  {
    name: 'an empty observed_at',
    mutate: (d) => {
      d.observed_at = ''
    },
    error: 'observed_at must be a non-empty string'
  },
  {
    name: 'a missing observed_at',
    mutate: (d) => {
      delete d.observed_at
    },
    error: 'observed_at must be a non-empty string'
  },
  {
    name: 'an empty capture_method',
    mutate: (d) => {
      d.capture_method = ''
    },
    error: 'capture_method must be a non-empty string'
  },
  {
    name: 'a missing capture_method',
    mutate: (d) => {
      delete d.capture_method
    },
    error: 'capture_method must be a non-empty string'
  },
  {
    name: 'empty source_references',
    mutate: (d) => {
      d.source_references = []
    },
    error: 'source_references must be a non-empty array'
  },
  {
    name: 'non-array source_references',
    mutate: (d) => {
      d.source_references = 'Confluence page 14778372'
    },
    error: 'source_references must be a non-empty array'
  },
  {
    name: 'an empty notice',
    mutate: (d) => {
      d.notice = ''
    },
    error: 'notice must be a non-empty string'
  },
  {
    name: 'an extra numbered child',
    mutate: (d) => {
      d.numbered_children.push({ ...d.numbered_children[0] })
    },
    error: `numbered_children must contain exactly ${EXPECTED_CHILD_COUNT} entries, got ${EXPECTED_CHILD_COUNT + 1}`
  },
  {
    name: 'an unexpected child number',
    mutate: (d) => {
      d.numbered_children[0].number = '99'
    },
    error: 'unexpected child number 99'
  },
  {
    name: 'an empty page_id',
    mutate: (d) => {
      d.numbered_children[0].page_id = ''
    },
    error: 'child 00 has empty page_id'
  },
  {
    name: 'a missing page_id',
    mutate: (d) => {
      delete d.numbered_children[0].page_id
    },
    error: 'child 00 has empty page_id'
  },
  {
    name: 'an empty title',
    mutate: (d) => {
      d.numbered_children[0].title = ''
    },
    error: 'child 00 has empty title'
  },
  {
    name: 'a title whose prefix disagrees with its number',
    mutate: (d) => {
      d.numbered_children[7].title = '08 – Embeddings, Retrieval and Search Quality'
    },
    error: 'child 07 title does not start with its number'
  },
  {
    name: 'a wrong blueprint page id',
    mutate: (d) => {
      d.blueprint.page_id = '1234567'
    },
    error: `blueprint.page_id must be ${EXPECTED_BLUEPRINT}`
  },
  {
    name: 'a missing blueprint object',
    mutate: (d) => {
      delete d.blueprint
    },
    error: `blueprint.page_id must be ${EXPECTED_BLUEPRINT}`
  },
  {
    name: 'a blueprint that is also one of the numbered children',
    mutate: (d) => {
      d.numbered_children[0].page_id = EXPECTED_BLUEPRINT
    },
    error: 'blueprint must not also be one of the numbered children'
  },
  {
    name: 'a wrong root_title',
    mutate: (d) => {
      d.root_title = 'Something Else'
    },
    error: `root_title must be ${JSON.stringify(EXPECTED_ROOT_TITLE)}`
  },
  {
    name: 'a wrong blueprint title',
    mutate: (d) => {
      d.blueprint.title = 'Wrong Blueprint Title'
    },
    error: `blueprint.title must be ${JSON.stringify(EXPECTED_BLUEPRINT_TITLE)}`
  }
]

for (const { name, mutate, error } of MUTATIONS) {
  test(`rejects ${name}`, () => {
    const doc = freshEvidence()
    mutate(doc)
    const errors = validateEvidence(doc)
    assert.ok(errors.includes(error), `expected "${error}", got: ${errors.join('; ')}`)
  })
}

// numbered_children not being an array short-circuits the per-child and
// blueprint checks, so the absence of blueprint findings is part of the contract.
test('rejects non-array numbered_children and returns before the blueprint checks', () => {
  const doc = freshEvidence()
  doc.numbered_children = { '00': '15138817' }
  const errors = validateEvidence(doc)
  assert.ok(errors.includes('numbered_children must be an array'), errors.join('; '))
  assert.equal(
    errors.some((e) => e.startsWith('blueprint')),
    false,
    `blueprint checks must not run after the early return, got: ${errors.join('; ')}`
  )
})

// --- negative: exact historical identity (PO finding I-1) ---------------------
// Structural validity is not enough for a frozen artifact: a unique-but-wrong ID
// and a correctly-prefixed-but-wrong title are both corruption of the record.

test('rejects a unique but wrong page ID', () => {
  const doc = freshEvidence()
  doc.numbered_children[7].page_id = '99999999'
  const errors = validateEvidence(doc)

  assert.ok(
    errors.includes('child 07 page_id must be 15269889, got 99999999'),
    errors.join('; ')
  )
  // Prove the rejection is an exact-identity mismatch, not a structural one:
  // the value is unique, non-empty and well-formed.
  assert.equal(
    errors.some((e) => e.startsWith('duplicate page_id')),
    false,
    `must not be rejected as a duplicate: ${errors.join('; ')}`
  )
  assert.equal(
    errors.some((e) => e.includes('has empty page_id')),
    false,
    `must not be rejected as empty: ${errors.join('; ')}`
  )
})

test('rejects a wrong full title whose number prefix is still valid', () => {
  const doc = freshEvidence()
  doc.numbered_children[7].title = '07 – Wrong Title'
  const errors = validateEvidence(doc)

  assert.ok(
    errors.includes(
      'child 07 title must be "07 – Embeddings, Retrieval and Search Quality", got "07 – Wrong Title"'
    ),
    errors.join('; ')
  )
  // Prove the rejection is an exact-title mismatch, not the prefix rule:
  // "07 " is still the correct prefix, so the prefix rule must stay silent.
  assert.equal(
    errors.some((e) => e.includes('title does not start with its number')),
    false,
    `prefix rule must not fire: ${errors.join('; ')}`
  )
  assert.equal(
    errors.some((e) => e.includes('has empty title')),
    false,
    `must not be rejected as empty: ${errors.join('; ')}`
  )
})
