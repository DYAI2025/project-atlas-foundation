// ATLAS-40 slice 2: the purity guard the pure core modules are scanned with.
//
// One copy, imported by every suite that guards a module in
// viewer/atlas39/core/. It lives here because it was already re-derived once:
// the gesture suite built and measured this scanner, the view-state suite then
// re-spelled a raw `source.includes(token)` list of its own, and the two
// disagreed in both directions.
//
// Scan the CODE, not the English. The guarded modules carry long, load-bearing
// comments, and 'window', 'document', 'navigator', 'performance' and 'process'
// are ordinary words inside them — a raw substring scan over the whole file
// fires on vocabulary rather than on capability use, and it already did once:
// the comment "a window losing the pointer" tripped the guard while the code
// was pure. Measured again on the view-state suite's re-spelling, on a
// byte-identical pure module: "The trade-off is documented in the runbook."
// hits `document`, "a window onto the graph" hits `window`, a sentence ending
// "reading process." hits `process.`, "never a crypto digest" hits `crypto` —
// four ordinary comments, four red suites. In the other direction that same
// list is blind to `const clock = Date` + `clock.now()`, to
// `navigator.userAgent`, to `queueMicrotask` and to `eval`, all four of which
// the denylists below name on a word boundary.
//
// Removing the comments with two regexes over raw text was itself defeatable,
// and measured to be: `source.replace(/\/\*[\s\S]*?\*\//g, '')` cannot tell a
// block-comment delimiter from an ordinary string literal, so appending
// `const OPEN_MARK = '/*'` … `const CLOSE_MARK = '*/'` around a probe that
// really referenced document, window and navigator deleted the probe BEFORE the
// denylists ever saw it, and the suite stayed green. The comment stripper is
// therefore a small scanner that knows where literals begin and end.
//
// Knowing strings alone was not enough, and the hole was the same class again:
// a scanner blind to REGULAR EXPRESSION literals reads `/\//` as `/\` followed
// by a line comment and deletes the rest of the line. Measured on the
// string-aware predecessor: stripComments("const SLASH_RE = /\\//; const t =
// document.title") returned "const SLASH_RE = /\\" and purityViolations() of
// the same text returned []. End to end, appending
// `export const SLASH_RE = /\//` plus a `document.title + Date.now()` probe to
// viewer/atlas39/core/view-state.mjs left that suite green at 18/18 with the
// probe provably on disk. So the scanner now classifies a `/` before it decides
// anything, and refuses rather than guesses when it cannot.
//
// This helper's own capability is pinned by test in
// test/atlas40-gesture.test.mjs ("the purity guard cannot be switched off by a
// string or a regular expression literal, and sees imports and randomness"),
// over the exact two mutations that defeated its predecessors.

/** Thrown instead of guessing. A scan that cannot classify a `/` deletes nothing. */
export class PurityScanError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PurityScanError'
  }
}

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/

/**
 * The keywords after which a `/` opens a regular expression instead of dividing.
 * Without them `return /x/.test(s)` would be read as a division and the regex
 * body scanned as code.
 */
const REGEX_AFTER_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw'
])

/** End index (exclusive) of the string or template literal opened at `start`. */
function literalEnd(source, start) {
  const quote = source[start]
  let i = start + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    i += 1
  }
  // Unterminated: keep the rest verbatim. Deleting it is the one thing this
  // scanner must never do on input it does not understand.
  return source.length
}

/**
 * End index (exclusive) of the regular-expression literal that starts at
 * `start`, or -1 when the text from `start` is not one. A regex literal cannot
 * span a line, and a `/` inside a `[...]` character class does not close it.
 */
function regexLiteralEnd(source, start) {
  let i = start + 1
  let inClass = false
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\n') return -1
    if (ch === '\\') {
      i += 2
      continue
    }
    if (inClass) {
      if (ch === ']') inClass = false
    } else if (ch === '[') {
      inClass = true
    } else if (ch === '/') {
      i += 1
      while (i < source.length && IDENTIFIER_CHAR.test(source[i])) i += 1
      return i
    }
    i += 1
  }
  return -1
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length

/**
 * Removes `//` and block comments, and only those. String, template and
 * regular-expression literals are code, so a comment delimiter inside any of
 * them is text and cannot switch the scan off.
 *
 * What it knows, stated exactly rather than as "the way a JavaScript reader
 * does" — the previous wording claimed a completeness this has never had:
 *
 * - `//` and `/*` are checked before a regular expression is considered, which
 *   is what a JavaScript lexer does and not a shortcut: neither sequence can
 *   open a regex literal.
 * - A `/` in any other position is a regex literal when a regex could start
 *   there, decided from the last significant character — an operand end
 *   (identifier, `)`, `]`, `}`, a closing quote) means division, anything else
 *   means regex, and an identifier is looked up in REGEX_AFTER_KEYWORDS.
 * - A regex literal that does not close on its own line is refused with a
 *   PurityScanError. Nothing is deleted on a guess.
 *
 * The one residual: a regex literal written directly after `)` or `}` — the
 * `if (x) /re/.test(y)` and statement-position shapes — is read as a division,
 * because telling those apart needs the parenthesis's own keyword. The body is
 * then emitted verbatim, so nothing is hidden by it unless that body contains a
 * literal `//` or `/*`. No guarded module contains either shape; this is written
 * down so the next hole in this file is found by reading rather than by
 * measuring it.
 */
export function stripComments(source) {
  let out = ''
  let i = 0
  // The last significant character emitted, and the identifier it ended, are
  // all that separates a division from a regular expression.
  let prev = ''
  let prevWord = ''

  const keep = (text) => {
    out += text
    for (const ch of text) {
      if (/\s/.test(ch)) continue
      prev = ch
      prevWord = IDENTIFIER_CHAR.test(ch) ? prevWord + ch : ''
    }
  }

  const regexCanStart = () => {
    if (prev === '') return true
    if (prev === ')' || prev === ']' || prev === '}') return false
    if (prev === "'" || prev === '"' || prev === '`') return false
    if (IDENTIFIER_CHAR.test(prev)) return REGEX_AFTER_KEYWORDS.has(prevWord)
    return true
  }

  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = literalEnd(source, i)
      keep(source.slice(i, end))
      i = end
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (ch === '/' && regexCanStart()) {
      const end = regexLiteralEnd(source, i)
      if (end === -1) {
        throw new PurityScanError(
          `unterminated regular expression literal at line ${lineOf(source, i)}: ` +
            'the purity scanner refuses to guess where it ends'
        )
      }
      keep(source.slice(i, end))
      i = end
      continue
    }
    keep(ch)
    i += 1
  }
  return out
}

/** Property-access spellings, which prose does not produce. */
export const FORBIDDEN_TOKENS = [
  'Date.', 'new Date', 'Math.random', 'performance.',
  'document.', 'window.', 'globalThis', 'navigator.', 'localStorage',
  'requestAnimationFrame', 'crypto.'
]

/**
 * Bare identifiers, matched on word boundaries over already comment-free code.
 * Property-access spellings alone cannot see `typeof document`, `fetch(...)`,
 * `setTimeout(...)`, a static `import` or `crypto.getRandomValues` — the last
 * two being the most direct ways to make a core module impure, and both
 * invisible to the first two versions of this guard.
 */
export const FORBIDDEN_IDENTIFIERS = [
  'window', 'document', 'navigator', 'performance', 'globalThis',
  'localStorage', 'sessionStorage', 'indexedDB', 'process', 'fetch',
  'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask',
  'requestAnimationFrame', 'Date', 'XMLHttpRequest', 'WebSocket', 'require',
  'import', 'crypto', 'eval', 'Worker'
]

/** `import … from '…'` and `export … from '…'` both spell this. */
export const MODULE_SPECIFIER = /\bfrom\s*['"]/

/** Every rule above, applied to one source text. Returns what it found. */
export function purityViolations(source) {
  const code = stripComments(source)
  const found = []
  for (const token of FORBIDDEN_TOKENS) if (code.includes(token)) found.push(token)
  for (const identifier of FORBIDDEN_IDENTIFIERS) {
    if (new RegExp(`\\b${identifier}\\b`).test(code)) found.push(identifier)
  }
  if (MODULE_SPECIFIER.test(code)) found.push("from '<specifier>'")
  return found
}
