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
// The V1 registry contract is closed: exactly these root and project fields,
// nothing more. Unknown keys are drift, not extensibility.
const ALLOWED_ROOT_FIELDS = ['schema_version', 'project_id', 'description', 'projects']
const REQUIRED_PROJECT_FIELDS = [
  'project_id',
  'jira_key',
  'confluence_space_key',
  'root_page_id',
  'allowed_writers',
  'approval_workflow',
  'status'
]
// Slice 1 covers exactly the three decided V1 projects (DEC-05), and each one
// keeps its decided jira_key/root_page_id tuple. Uniqueness alone is not
// enough: swapped-but-unique values would route deterministically to the WRONG
// project. Keyed by project_id, never by array position — the order of
// `projects` carries no meaning.
const EXPECTED_PROJECTS = {
  ATLAS: { jira_key: 'ATLAS', root_page_id: '14778372' },
  EASYTREE: { jira_key: 'EYT', root_page_id: '5505026' },
  PLUMBLINE: { jira_key: 'PLUM', root_page_id: '7503873' }
}
const EXPECTED_PROJECT_IDS = Object.keys(EXPECTED_PROJECTS)
const EXPECTED_DESCRIPTION =
  'Writer registry: deterministic project routing per DEC-05/DEC-09. Never inferred from titles or semantics.'
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
  for (const field of Object.keys(data)) {
    if (!ALLOWED_ROOT_FIELDS.includes(field)) {
      throw new RegistryError('E_REGISTRY_INVALID', `unknown registry root field "${field}"`)
    }
  }
  if (data.description !== EXPECTED_DESCRIPTION) {
    throw new RegistryError('E_REGISTRY_INVALID', 'registry description must be exactly the decided V1 wording')
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
    for (const field of Object.keys(project)) {
      if (!REQUIRED_PROJECT_FIELDS.includes(field)) {
        throw new RegistryError('E_REGISTRY_INVALID', `unknown registry project field "${field}"`)
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

  // Runs last, after uniqueness: values that are unique but attached to the
  // wrong project are a routing defect, not an ambiguity.
  for (const project of data.projects) {
    const expected = EXPECTED_PROJECTS[project.project_id]
    for (const field of ['jira_key', 'root_page_id']) {
      if (project[field] !== expected[field]) {
        throw new RegistryError(
          'E_REGISTRY_INVALID',
          `project "${project.project_id}" must keep the decided ${field} "${expected[field]}"`
        )
      }
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
