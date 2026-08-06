// Deterministic validator for contracts/local-adapter/v1/request.schema.json.
// Mirrors the schema rules explicitly; no dependencies. Errors are sorted by
// path, then code, so identical input always yields identical output.

export const CONTRACT_VERSION = '1.0.0'
export const ALLOWED_OPERATIONS = ['inspect']

const KNOWN_ROOT_FIELDS = ['contract_version', 'request_id', 'repository', 'operation']
const KNOWN_REPO_FIELDS = ['owner', 'name']

const err = (path, code, message) => ({ path, code, message })

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function checkNonEmptyString(value, path, errors) {
  if (typeof value !== 'string') {
    errors.push(err(path, 'E_TYPE', 'must be a string'))
  } else if (value.length === 0) {
    errors.push(err(path, 'E_EMPTY', 'must not be empty'))
  }
}

export function validateRequest(data) {
  if (!isPlainObject(data)) {
    return buildResponse([err('/', 'E_ROOT_TYPE', 'request must be a JSON object')])
  }

  const errors = []

  for (const key of Object.keys(data)) {
    if (!KNOWN_ROOT_FIELDS.includes(key)) {
      errors.push(err(`/${key}`, 'E_UNKNOWN_FIELD', `unknown field "${key}"`))
    }
  }

  if (!('contract_version' in data)) {
    errors.push(err('/contract_version', 'E_MISSING', 'required field missing'))
  } else if (typeof data.contract_version !== 'string') {
    errors.push(err('/contract_version', 'E_TYPE', 'must be a string'))
  } else if (data.contract_version !== CONTRACT_VERSION) {
    errors.push(err('/contract_version', 'E_CONST', `must be "${CONTRACT_VERSION}"`))
  }

  if (!('request_id' in data)) {
    errors.push(err('/request_id', 'E_MISSING', 'required field missing'))
  } else {
    checkNonEmptyString(data.request_id, '/request_id', errors)
  }

  if (!('repository' in data)) {
    errors.push(err('/repository', 'E_MISSING', 'required field missing'))
  } else if (!isPlainObject(data.repository)) {
    errors.push(err('/repository', 'E_TYPE', 'must be an object'))
  } else {
    for (const key of Object.keys(data.repository)) {
      if (!KNOWN_REPO_FIELDS.includes(key)) {
        errors.push(err(`/repository/${key}`, 'E_UNKNOWN_FIELD', `unknown field "${key}"`))
      }
    }
    for (const field of KNOWN_REPO_FIELDS) {
      if (!(field in data.repository)) {
        errors.push(err(`/repository/${field}`, 'E_MISSING', 'required field missing'))
      } else {
        checkNonEmptyString(data.repository[field], `/repository/${field}`, errors)
      }
    }
  }

  if (!('operation' in data)) {
    errors.push(err('/operation', 'E_MISSING', 'required field missing'))
  } else if (typeof data.operation !== 'string') {
    errors.push(err('/operation', 'E_TYPE', 'must be a string'))
  } else if (!ALLOWED_OPERATIONS.includes(data.operation)) {
    errors.push(err('/operation', 'E_ENUM', `must be one of: ${ALLOWED_OPERATIONS.join(', ')}`))
  }

  return buildResponse(errors)
}

export function buildResponse(errors) {
  const sorted = [...errors].sort(
    (a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)
  )
  return { contract_version: CONTRACT_VERSION, valid: sorted.length === 0, errors: sorted }
}
