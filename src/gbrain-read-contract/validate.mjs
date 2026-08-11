// Deterministic checker for the versioned gbrain-read / graph-projection contract
// (ATLAS-22, Slice 2). Mirrors contracts/gbrain-read/v1/*.schema.json explicitly;
// no schema interpreter, no dependencies.
//
// This module is a CONTRACT CHECKER, not a reader: it never contacts Confluence,
// never contacts gbrain, never produces a graph. It validates documents that are
// handed to it.
//
// Errors are sorted by path, then code, using plain UTF-16 code-unit comparison
// (never localeCompare — its collation depends on the process locale and would
// break byte-identical output across environments). Error paths are display
// strings, not RFC 6901 JSON Pointers: keys are not escaped. Request errors are
// namespaced under /request, snapshot errors under /snapshot, so a single
// response can carry both without ambiguity.
import { SELECTOR_KINDS } from '../registry/resolve.mjs'

export const CONTRACT_VERSION = '1.0.0'
export const OPERATIONS = ['read_graph']

// Every code validateRequest / validateSnapshot / validateScope can emit. The CLI
// adds its technical codes; the parity test derives those from cli.mjs source so
// the published response-schema enum can never drift.
export const CONTRACT_ERROR_CODES = [
  'E_MISSING',
  'E_TYPE',
  'E_EMPTY',
  'E_CONST',
  'E_ENUM',
  'E_UNKNOWN_FIELD',
  'E_ROOT_TYPE',
  'E_CHARSET',
  'E_ID_DERIVATION',
  'E_DUPLICATE_NODE_ID',
  'E_DUPLICATE_EDGE_ID',
  'E_EDGE_ENDPOINT_UNKNOWN',
  'E_ORDER',
  'E_UNKNOWN_PROJECT',
  'E_PROJECT_MISMATCH',
  'E_SOURCE_SCOPE'
]

const REQUEST_FIELDS = ['contract_version', 'request_id', 'project', 'operation']
const PROJECT_FIELDS = ['selector_kind', 'selector_value']

// The V1 projection id scheme. These two snapshot fields exist so the boundary is
// machine-visible in the artifact itself: these identifiers are projection-local
// and are NOT the final canonical entity identifiers (Confluence page 05 is
// unresolved; PO decision D9). Both are consts — a snapshot can never claim
// canonical identity by editing a field.
export const ID_SCHEME = 'projection-local/v1'
export const SOURCE_KINDS = ['confluence']
export const EDGE_ORIGINS = ['explicit']
export const ID_SEPARATOR = ':'
// Every component that participates in an identifier must avoid the separator, so
// composition is transparent and decomposition is unambiguous without escaping.
export const ID_COMPONENT_PATTERN = /^[A-Za-z0-9._-]+$/

const SNAPSHOT_FIELDS = [
  'contract_version',
  'project_id',
  'id_scheme',
  'canonical_entity_ids',
  'source',
  'nodes',
  'edges'
]
const SOURCE_FIELDS = ['source_kind', 'source_id']
const NODE_FIELDS = ['node_id', 'source_ref', 'label']
const EDGE_FIELDS = ['edge_id', 'from', 'to', 'relation_type', 'origin']

// Transparent, hash-free composition. Sprint 2 can reproduce an identifier from
// the snapshot's own declared fields with string concatenation alone.
export const composeNodeId = (projectId, sourceKind, sourceId, sourceRef) =>
  [projectId, sourceKind, sourceId, sourceRef].join(ID_SEPARATOR)

export const composeEdgeId = (projectId, sourceKind, sourceId, relationType, fromRef, toRef) =>
  [projectId, sourceKind, sourceId, relationType, fromRef, toRef].join(ID_SEPARATOR)

const err = (path, code, message) => ({ path, code, message })

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

export function sortErrors(errors) {
  return [...errors].sort((a, b) => byCodeUnit(a.path, b.path) || byCodeUnit(a.code, b.code))
}

function checkUnknownFields(object, allowed, prefix, errors) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      errors.push(err(`${prefix}/${key}`, 'E_UNKNOWN_FIELD', `unknown field "${key}"`))
    }
  }
}

function checkNonEmptyString(value, path, errors) {
  if (typeof value !== 'string') {
    errors.push(err(path, 'E_TYPE', 'must be a string'))
    return false
  }
  if (value.length === 0) {
    errors.push(err(path, 'E_EMPTY', 'must not be empty'))
    return false
  }
  return true
}

function checkConst(value, expected, path, errors) {
  if (typeof value !== 'string') {
    errors.push(err(path, 'E_TYPE', 'must be a string'))
    return false
  }
  if (value !== expected) {
    errors.push(err(path, 'E_CONST', `must be ${JSON.stringify(expected)}`))
    return false
  }
  return true
}

export function validateRequest(data) {
  if (!isPlainObject(data)) {
    return [err('/request', 'E_ROOT_TYPE', 'request must be a JSON object')]
  }

  const errors = []
  checkUnknownFields(data, REQUEST_FIELDS, '/request', errors)

  if (!('contract_version' in data)) {
    errors.push(err('/request/contract_version', 'E_MISSING', 'required field missing'))
  } else {
    checkConst(data.contract_version, CONTRACT_VERSION, '/request/contract_version', errors)
  }

  if (!('request_id' in data)) {
    errors.push(err('/request/request_id', 'E_MISSING', 'required field missing'))
  } else {
    checkNonEmptyString(data.request_id, '/request/request_id', errors)
  }

  if (!('project' in data)) {
    errors.push(err('/request/project', 'E_MISSING', 'required field missing'))
  } else if (!isPlainObject(data.project)) {
    errors.push(err('/request/project', 'E_TYPE', 'must be an object'))
  } else {
    checkUnknownFields(data.project, PROJECT_FIELDS, '/request/project', errors)
    if (!('selector_kind' in data.project)) {
      errors.push(err('/request/project/selector_kind', 'E_MISSING', 'required field missing'))
    } else if (typeof data.project.selector_kind !== 'string') {
      errors.push(err('/request/project/selector_kind', 'E_TYPE', 'must be a string'))
    } else if (!SELECTOR_KINDS.includes(data.project.selector_kind)) {
      // Selector kinds are owned by the writer registry (src/registry/resolve.mjs).
      // They are imported, never restated here: routing stays deterministic and
      // single-sourced, and title or fuzzy matching remains impossible by construction.
      errors.push(
        err(
          '/request/project/selector_kind',
          'E_ENUM',
          `must be one of: ${SELECTOR_KINDS.join(', ')}`
        )
      )
    }
    if (!('selector_value' in data.project)) {
      errors.push(err('/request/project/selector_value', 'E_MISSING', 'required field missing'))
    } else {
      checkNonEmptyString(data.project.selector_value, '/request/project/selector_value', errors)
    }
  }

  if (!('operation' in data)) {
    errors.push(err('/request/operation', 'E_MISSING', 'required field missing'))
  } else if (typeof data.operation !== 'string') {
    errors.push(err('/request/operation', 'E_TYPE', 'must be a string'))
  } else if (!OPERATIONS.includes(data.operation)) {
    errors.push(err('/request/operation', 'E_ENUM', `must be one of: ${OPERATIONS.join(', ')}`))
  }

  return sortErrors(errors)
}

// Returns true only when the value is a non-empty string made exclusively of
// identifier-safe characters. Callers use the result to decide whether an
// identifier derivation is even computable: garbage components must produce one
// precise finding, never a cascade of derived ones.
function checkIdComponent(value, path, errors) {
  if (!checkNonEmptyString(value, path, errors)) return false
  if (!ID_COMPONENT_PATTERN.test(value)) {
    errors.push(
      err(path, 'E_CHARSET', `must match ${ID_COMPONENT_PATTERN.source} (identifier component)`)
    )
    return false
  }
  return true
}

function validateSnapshotSource(source, errors) {
  if (!isPlainObject(source)) {
    errors.push(err('/snapshot/source', 'E_TYPE', 'must be an object'))
    return { sourceKind: null, sourceIdOk: false, sourceId: null }
  }
  checkUnknownFields(source, SOURCE_FIELDS, '/snapshot/source', errors)

  let sourceKind = null
  if (!('source_kind' in source)) {
    errors.push(err('/snapshot/source/source_kind', 'E_MISSING', 'required field missing'))
  } else if (typeof source.source_kind !== 'string') {
    errors.push(err('/snapshot/source/source_kind', 'E_TYPE', 'must be a string'))
  } else if (!SOURCE_KINDS.includes(source.source_kind)) {
    errors.push(
      err('/snapshot/source/source_kind', 'E_ENUM', `must be one of: ${SOURCE_KINDS.join(', ')}`)
    )
  } else {
    sourceKind = source.source_kind
  }

  let sourceIdOk = false
  if (!('source_id' in source)) {
    errors.push(err('/snapshot/source/source_id', 'E_MISSING', 'required field missing'))
  } else {
    sourceIdOk = checkIdComponent(source.source_id, '/snapshot/source/source_id', errors)
  }

  return { sourceKind, sourceIdOk, sourceId: sourceIdOk ? source.source_id : null }
}

function validateNodes(nodes, prefixParts, errors) {
  // declaredIds answers "does this endpoint exist"; refById answers "what is this
  // endpoint's source_ref". They are deliberately separate: a node with a missing
  // or malformed source_ref is still a declared node, so it must not additionally
  // manufacture phantom dangling-endpoint findings on every edge that points at it.
  const declaredIds = new Set()
  const refById = new Map()
  if (!Array.isArray(nodes)) {
    errors.push(err('/snapshot/nodes', 'E_TYPE', 'must be an array'))
    return { declaredIds, refById }
  }

  let previousId = null
  nodes.forEach((node, index) => {
    const at = `/snapshot/nodes/${index}`
    if (!isPlainObject(node)) {
      errors.push(err(at, 'E_TYPE', 'must be an object'))
      return
    }
    checkUnknownFields(node, NODE_FIELDS, at, errors)

    let refOk = false
    if (!('source_ref' in node)) {
      errors.push(err(`${at}/source_ref`, 'E_MISSING', 'required field missing'))
    } else {
      refOk = checkIdComponent(node.source_ref, `${at}/source_ref`, errors)
    }

    if (!('label' in node)) {
      errors.push(err(`${at}/label`, 'E_MISSING', 'required field missing'))
    } else {
      // Display text, deliberately NOT identifier-constrained.
      checkNonEmptyString(node.label, `${at}/label`, errors)
    }

    let idOk = false
    if (!('node_id' in node)) {
      errors.push(err(`${at}/node_id`, 'E_MISSING', 'required field missing'))
    } else {
      idOk = checkNonEmptyString(node.node_id, `${at}/node_id`, errors)
    }

    if (idOk && refOk && prefixParts !== null) {
      const expected = composeNodeId(...prefixParts, node.source_ref)
      if (node.node_id !== expected) {
        errors.push(
          err(`${at}/node_id`, 'E_ID_DERIVATION', `must be ${JSON.stringify(expected)}`)
        )
      }
    }

    if (idOk) {
      if (declaredIds.has(node.node_id)) {
        errors.push(err(`${at}/node_id`, 'E_DUPLICATE_NODE_ID', 'node_id is not unique'))
      } else {
        declaredIds.add(node.node_id)
        if (refOk) refById.set(node.node_id, node.source_ref)
      }
      if (previousId !== null && byCodeUnit(node.node_id, previousId) < 0) {
        errors.push(
          err(at, 'E_ORDER', 'nodes must be sorted by node_id in ascending code-unit order')
        )
      }
      previousId = node.node_id
    }
  })

  return { declaredIds, refById }
}

function validateEdges(edges, prefixParts, { declaredIds, refById }, errors) {
  if (!Array.isArray(edges)) {
    errors.push(err('/snapshot/edges', 'E_TYPE', 'must be an array'))
    return
  }

  const seen = new Set()
  let previousId = null
  edges.forEach((edge, index) => {
    const at = `/snapshot/edges/${index}`
    if (!isPlainObject(edge)) {
      errors.push(err(at, 'E_TYPE', 'must be an object'))
      return
    }
    checkUnknownFields(edge, EDGE_FIELDS, at, errors)

    let relationOk = false
    if (!('relation_type' in edge)) {
      errors.push(err(`${at}/relation_type`, 'E_MISSING', 'required field missing'))
    } else {
      // Syntactically constrained, deliberately NOT an enum: the canonical
      // relation-type catalog is an open point on Confluence page 08 and is not
      // decided by this contract.
      relationOk = checkIdComponent(edge.relation_type, `${at}/relation_type`, errors)
    }

    if (!('origin' in edge)) {
      errors.push(err(`${at}/origin`, 'E_MISSING', 'required field missing'))
    } else if (typeof edge.origin !== 'string') {
      errors.push(err(`${at}/origin`, 'E_TYPE', 'must be a string'))
    } else if (!EDGE_ORIGINS.includes(edge.origin)) {
      // The field preserves the explicit/inferred distinction required by page 08;
      // V1 admits explicit edges only and generates no inferred relations.
      errors.push(err(`${at}/origin`, 'E_ENUM', `must be one of: ${EDGE_ORIGINS.join(', ')}`))
    }

    const endpoints = {}
    for (const side of ['from', 'to']) {
      if (!(side in edge)) {
        errors.push(err(`${at}/${side}`, 'E_MISSING', 'required field missing'))
        continue
      }
      if (!checkNonEmptyString(edge[side], `${at}/${side}`, errors)) continue
      if (!declaredIds.has(edge[side])) {
        errors.push(
          err(`${at}/${side}`, 'E_EDGE_ENDPOINT_UNKNOWN', `no node declares node_id ${JSON.stringify(edge[side])}`)
        )
        continue
      }
      endpoints[side] = refById.get(edge[side])
    }

    let idOk = false
    if (!('edge_id' in edge)) {
      errors.push(err(`${at}/edge_id`, 'E_MISSING', 'required field missing'))
    } else {
      idOk = checkNonEmptyString(edge.edge_id, `${at}/edge_id`, errors)
    }

    if (
      idOk &&
      relationOk &&
      prefixParts !== null &&
      endpoints.from !== undefined &&
      endpoints.to !== undefined
    ) {
      const expected = composeEdgeId(
        ...prefixParts,
        edge.relation_type,
        endpoints.from,
        endpoints.to
      )
      if (edge.edge_id !== expected) {
        errors.push(
          err(`${at}/edge_id`, 'E_ID_DERIVATION', `must be ${JSON.stringify(expected)}`)
        )
      }
    }

    if (idOk) {
      if (seen.has(edge.edge_id)) {
        errors.push(err(`${at}/edge_id`, 'E_DUPLICATE_EDGE_ID', 'edge_id is not unique'))
      } else {
        seen.add(edge.edge_id)
      }
      if (previousId !== null && byCodeUnit(edge.edge_id, previousId) < 0) {
        errors.push(
          err(at, 'E_ORDER', 'edges must be sorted by edge_id in ascending code-unit order')
        )
      }
      previousId = edge.edge_id
    }
  })
}

export function validateSnapshot(data) {
  if (!isPlainObject(data)) {
    return [err('/snapshot', 'E_ROOT_TYPE', 'graph snapshot must be a JSON object')]
  }

  const errors = []
  checkUnknownFields(data, SNAPSHOT_FIELDS, '/snapshot', errors)

  if (!('contract_version' in data)) {
    errors.push(err('/snapshot/contract_version', 'E_MISSING', 'required field missing'))
  } else {
    checkConst(data.contract_version, CONTRACT_VERSION, '/snapshot/contract_version', errors)
  }

  let projectIdOk = false
  if (!('project_id' in data)) {
    errors.push(err('/snapshot/project_id', 'E_MISSING', 'required field missing'))
  } else {
    projectIdOk = checkIdComponent(data.project_id, '/snapshot/project_id', errors)
  }

  if (!('id_scheme' in data)) {
    errors.push(err('/snapshot/id_scheme', 'E_MISSING', 'required field missing'))
  } else {
    checkConst(data.id_scheme, ID_SCHEME, '/snapshot/id_scheme', errors)
  }

  if (!('canonical_entity_ids' in data)) {
    errors.push(err('/snapshot/canonical_entity_ids', 'E_MISSING', 'required field missing'))
  } else if (typeof data.canonical_entity_ids !== 'boolean') {
    errors.push(err('/snapshot/canonical_entity_ids', 'E_TYPE', 'must be a boolean'))
  } else if (data.canonical_entity_ids !== false) {
    errors.push(err('/snapshot/canonical_entity_ids', 'E_CONST', 'must be false'))
  }

  let source = { sourceKind: null, sourceIdOk: false, sourceId: null }
  if (!('source' in data)) {
    errors.push(err('/snapshot/source', 'E_MISSING', 'required field missing'))
  } else {
    source = validateSnapshotSource(data.source, errors)
  }

  // Identifier derivation is only computable when every prefix component is itself
  // valid; otherwise the component findings stand alone and no derived noise is added.
  const prefixParts =
    projectIdOk && source.sourceKind !== null && source.sourceIdOk
      ? [data.project_id, source.sourceKind, source.sourceId]
      : null

  let nodeIndex = { declaredIds: new Set(), refById: new Map() }
  if (!('nodes' in data)) {
    errors.push(err('/snapshot/nodes', 'E_MISSING', 'required field missing'))
  } else {
    nodeIndex = validateNodes(data.nodes, prefixParts, errors)
  }

  if (!('edges' in data)) {
    errors.push(err('/snapshot/edges', 'E_MISSING', 'required field missing'))
  } else {
    validateEdges(data.edges, prefixParts, nodeIndex, errors)
  }

  return sortErrors(errors)
}

// Scope binding between the resolved registry project and the supplied snapshot.
// Resolution itself is NOT reimplemented here: the caller resolves through
// src/registry/resolve.mjs (exact matching, deny on ambiguity) and passes the
// resolved project — or null — in. Deny by default (DEC-09): an unresolved
// selector is a denial, never an implicit "any project".
export function validateScope(project, snapshot) {
  if (project === null || project === undefined) {
    return [
      err(
        '/request/project/selector_value',
        'E_UNKNOWN_PROJECT',
        'no project matches the supplied selector'
      )
    ]
  }
  if (!isPlainObject(snapshot)) return []

  if (snapshot.project_id !== project.project_id) {
    // Cross-project input: the snapshot belongs to a different project than the
    // request resolved. Reported alone — checking a foreign project's source scope
    // against this project's root would only add derived noise.
    return [
      err(
        '/snapshot/project_id',
        'E_PROJECT_MISMATCH',
        `must be ${JSON.stringify(project.project_id)} for the resolved project`
      )
    ]
  }

  // For confluence-sourced snapshots the source scope is the project's registered
  // root page. A snapshot that pairs this project with another project's root is a
  // scope violation even though the project id matches.
  if (
    isPlainObject(snapshot.source) &&
    snapshot.source.source_kind === 'confluence' &&
    snapshot.source.source_id !== project.root_page_id
  ) {
    return [
      err(
        '/snapshot/source/source_id',
        'E_SOURCE_SCOPE',
        `must be the registered confluence root ${JSON.stringify(project.root_page_id)} of project ${JSON.stringify(project.project_id)}`
      )
    ]
  }

  return []
}

// Deterministic validation result. This is the checker's verdict, NOT the graph
// artifact: the graph snapshot is a standalone document and is never wrapped,
// echoed or re-emitted here. Field order is built explicitly — never by spreading
// an arbitrary object — so identical input yields byte-identical output.
export function buildResponse(projectId, errors) {
  const sorted = sortErrors(errors)
  return {
    contract_version: CONTRACT_VERSION,
    valid: sorted.length === 0,
    project_id: projectId ?? null,
    errors: sorted
  }
}
