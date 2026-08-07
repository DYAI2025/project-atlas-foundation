// Deterministic writer-registry resolver (ATLAS-12, Slice 1).
// Routing per DEC-05/DEC-09: exact matching only — no case normalization,
// no fuzzy matching, no substrings, no title/semantic inference. Fail closed:
// a structurally invalid or ambiguous registry is a technical error, never a
// silent "unknown project". Output field order is built explicitly so
// identical input yields byte-identical output.
import { readFileSync } from 'node:fs'

export const SCHEMA_VERSION = '1.0'
export const SELECTOR_KINDS = ['project_id', 'jira_key', 'root_page_id']

const REGISTRY_URL = new URL('../../config/project-registry.json', import.meta.url)
const REQUIRED_PROJECT_FIELDS = [
  'project_id',
  'jira_key',
  'confluence_space_key',
  'root_page_id',
  'allowed_writers',
  'approval_workflow',
  'status'
]
// Slice 1 covers exactly the three decided V1 projects (DEC-05).
const EXPECTED_PROJECT_IDS = ['ATLAS', 'EASYTREE', 'PLUMBLINE']
const EXPECTED_SPACE_KEY = 'PRODUKTMAN'
const EXPECTED_WORKFLOW = 'proposal->owner-approval->publish'
const EXPECTED_WRITERS = ['benjamin.poersch']
const EXPECTED_STATUS = 'active'

export class RegistryError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

export function validateRegistry(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new RegistryError('E_REGISTRY_INVALID', 'registry root must be an object')
  }
  if (data.schema_version !== SCHEMA_VERSION) {
    throw new RegistryError('E_REGISTRY_INVALID', `registry schema_version must be "${SCHEMA_VERSION}"`)
  }
  if (data.project_id !== 'ATLAS') {
    throw new RegistryError('E_REGISTRY_INVALID', 'registry project_id must be "ATLAS"')
  }
  if (!Array.isArray(data.projects)) {
    throw new RegistryError('E_REGISTRY_INVALID', 'registry projects must be an array')
  }

  for (const project of data.projects) {
    if (project === null || typeof project !== 'object' || Array.isArray(project)) {
      throw new RegistryError('E_REGISTRY_INVALID', 'every registry project must be an object')
    }
    for (const field of REQUIRED_PROJECT_FIELDS) {
      if (!(field in project)) {
        throw new RegistryError('E_REGISTRY_INVALID', `project is missing required field "${field}"`)
      }
    }
    for (const field of ['project_id', 'jira_key', 'confluence_space_key', 'root_page_id', 'approval_workflow', 'status']) {
      if (!isNonEmptyString(project[field])) {
        throw new RegistryError('E_REGISTRY_INVALID', `project field "${field}" must be a non-empty string`)
      }
    }
    if (project.confluence_space_key !== EXPECTED_SPACE_KEY) {
      throw new RegistryError('E_REGISTRY_INVALID', `confluence_space_key must be "${EXPECTED_SPACE_KEY}"`)
    }
    if (project.status !== EXPECTED_STATUS) {
      throw new RegistryError('E_REGISTRY_INVALID', `status must be "${EXPECTED_STATUS}"`)
    }
    if (project.approval_workflow !== EXPECTED_WORKFLOW) {
      throw new RegistryError('E_REGISTRY_INVALID', `approval_workflow must be "${EXPECTED_WORKFLOW}"`)
    }
    if (
      !Array.isArray(project.allowed_writers) ||
      project.allowed_writers.length !== EXPECTED_WRITERS.length ||
      project.allowed_writers.some((w, i) => w !== EXPECTED_WRITERS[i])
    ) {
      throw new RegistryError(
        'E_REGISTRY_INVALID',
        `allowed_writers must be exactly ${JSON.stringify(EXPECTED_WRITERS)}`
      )
    }
  }

  const actualIds = data.projects.map((p) => p.project_id).toSorted()
  if (JSON.stringify(actualIds) !== JSON.stringify([...EXPECTED_PROJECT_IDS].toSorted())) {
    throw new RegistryError(
      'E_REGISTRY_INVALID',
      `registry must contain exactly the V1 projects ${EXPECTED_PROJECT_IDS.join(', ')}`
    )
  }

  for (const field of ['project_id', 'jira_key', 'root_page_id']) {
    const values = data.projects.map((p) => p[field])
    if (new Set(values).size !== values.length) {
      throw new RegistryError('E_REGISTRY_AMBIGUOUS', `duplicate ${field} in registry`)
    }
  }

  return data
}

export function loadRegistry(registryUrl = REGISTRY_URL) {
  let raw
  try {
    raw = readFileSync(registryUrl, 'utf8')
  } catch {
    throw new RegistryError('E_REGISTRY_UNREADABLE', 'cannot read config/project-registry.json')
  }
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new RegistryError('E_REGISTRY_INVALID', 'registry is not valid JSON')
  }
  return validateRegistry(data)
}

export function resolveProject(registry, selectorKind, selectorValue) {
  if (!SELECTOR_KINDS.includes(selectorKind)) {
    throw new RegistryError('E_USAGE', `unknown selector kind "${selectorKind}"`)
  }
  const matches = registry.projects.filter((p) => p[selectorKind] === selectorValue)
  if (matches.length > 1) {
    throw new RegistryError('E_REGISTRY_AMBIGUOUS', `selector matches ${matches.length} projects`)
  }
  return matches.length === 1 ? matches[0] : null
}

// Response with deliberately fixed field order — never spread arbitrary objects.
export function buildResponse(project, errors = []) {
  return {
    schema_version: SCHEMA_VERSION,
    resolved: project !== null,
    project:
      project === null
        ? null
        : {
            project_id: project.project_id,
            jira_key: project.jira_key,
            confluence_space_key: project.confluence_space_key,
            root_page_id: project.root_page_id,
            allowed_writers: [...project.allowed_writers],
            approval_workflow: project.approval_workflow,
            status: project.status
          },
    errors
  }
}
