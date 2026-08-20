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
// The third hole was in the WORD the classification reads, not in the
// characters it sees. `keep()` skipped whitespace without ending the word it
// had been building, so `const subject = text` followed by
// `return /\//.test(subject)` left the previous word as `textreturn`, which is
// in no keyword list, so that `/` was lexed as a DIVISION and the `//`-deletion
// hole above re-opened one line later. This codebase is semicolon-free, so that
// is the ordinary shape of two statements, not a contrived one. Measured on the
// committed predecessor: purityViolations() of that function returned [], while
// the same function with `String(text)` on the line above — a `)` before the
// `return`, which ends the word — returned ["document.","document"]. End to
// end, appending it to viewer/atlas39/core/view-state.mjs left that suite green
// at exit 0, 18/18 with a DOM read and a clock on disk. A word now starts fresh
// after any non-identifier character, whitespace included.
//
// The fourth hole was the same class one nesting level down, and it made the
// story the paragraphs above tell about STRING literals false for TEMPLATE
// literals. `literalEnd()` scanned for the next unescaped backtick and knew
// nothing about `${ … }`, so a template that contains another template was
// closed on the INNER literal's opening backtick, and the inner literal's text
// landed in perceived-CODE position. Measured on the committed predecessor:
// stripComments("export function p08(text) {\n  const t = `a ${ `/*` } b`\n
// return t + text\n}\nexport function p08leak() {\n  return document.title +
// Date.now()\n}") returned "export function p08(text) {\n  const t = `a ${ `"
// — everything from the inner `/*` to end of file deleted — and
// purityViolations() of it returned []. The `//` spelling, `` `a ${ `//` } b` ``,
// deleted the rest of that line the same way. End to end, appended to
// viewer/atlas39/core/view-state.mjs and to viewer/atlas39/core/gesture.mjs,
// both suites stayed green at exit 0 (19/19 and 22/22) with `document.title`
// and `Date.now()` provably on disk. The scan therefore no longer treats a
// template as one flat literal: it carries a STACK, a `${ … }` substitution is
// scanned as code, and a template opened inside one nests.
//
// The fifth hole was a division that was really a regular expression.
// `regexCanStart()` answers `false` after `)`, `]` and `}` because telling
// `if (x) /re/.test(y)` from `(a + b) / c` needs the parenthesis's own keyword,
// which this scanner does not track. Reading a regex as a division is harmless
// by itself — the characters are emitted either way, so the denylists still see
// them — with one exception: two adjacent slashes inside the literal, which
// `/\//` has at its escape and its terminator, then meet the comment branches
// and delete the rest of the line. Measured on the committed predecessor:
// stripComments("export function p02(text) {\n  if (text) /\\//.test(
// document.title + Date.now())\n  return 1\n}") returned "…\n  if (text) /\\\n
// return 1\n}" and purityViolations() returned []; the statement-position
// spelling after `}` did the same. So the two readings are now told apart by
// the only thing that distinguishes them here: when a `/` in division position
// also reads as a regular-expression literal whose RAW TEXT carries a `//` or a
// `/*`, the literal is emitted verbatim instead. Nothing is deleted on a guess,
// and nothing is hidden either — an ordinary division keeps dividing, because
// `regexLiteralEnd()` stops at the first unescaped slash, so `total / 2 // half`
// yields the span `/ 2 /`, which carries neither delimiter.
//
// Two denylist spellings were closed with it, both measured to reach a real
// capability with the suites green: `\u0044ate.now()` and `\u0064ocument.title`
// are valid JavaScript, resolve to `Date` and `document`, and defeat every
// `\b<name>\b` rule below, so a `\u` escape anywhere in the comment-free code is
// itself refused; and `Function` was absent while `eval` was named, so
// `Function('return Da' + 'te.now()')` reached the clock the module is scanned
// for. No denylist is complete — these two were concrete, measured and
// closable, and closing them is not a claim that the third is not out there.
//
// This helper's own capability is pinned by test in
// test/atlas40-gesture.test.mjs ("the purity guard cannot be switched off by a
// string or a regular expression literal, and sees imports and randomness" and
// "the purity guard cannot be switched off by a nested template literal or a
// regex in division position, and sees escaped identifiers"), over the exact
// mutations that defeated its predecessors.

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

/**
 * End index (exclusive) of the single- or double-quoted string opened at
 * `start`. Only those two: a template literal is not a flat literal, because
 * its `${ … }` substitutions hold code that can open literals of its own, and
 * scanning one with this function closed the outer template on the inner one's
 * opening backtick. Templates are handled by the stack in `stripComments`.
 */
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
 * them is text and cannot switch the scan off — including a template literal
 * inside another template literal's `${ … }`, which is the shape that made the
 * previous wording of this sentence false.
 *
 * What it knows, stated exactly rather than as "the way a JavaScript reader
 * does" — an earlier wording claimed a completeness this has never had:
 *
 * - `//` and `/*` are checked before a regular expression is considered, which
 *   is what a JavaScript lexer does and not a shortcut: neither sequence can
 *   open a regex literal.
 * - A `/` in any other position is a regex literal when a regex could start
 *   there, decided from the last significant character — an operand end
 *   (identifier, `)`, `]`, `}`, a closing quote) means division, anything else
 *   means regex, and an identifier is looked up in REGEX_AFTER_KEYWORDS as the
 *   WORD it ends, where a word starts fresh after any non-identifier character
 *   including whitespace and a newline.
 * - A `/` the rule above calls a division is re-read as a regular-expression
 *   literal when it also parses as one AND that literal's raw text carries a
 *   `//` or a `/*`. Those are the only two spellings on which the two readings
 *   differ in what survives, because a division reading emits every other
 *   character untouched; on them the division reading deletes, so the reading
 *   that deletes nothing wins.
 * - A template literal is scanned with a stack, not as one flat span: `${ … }`
 *   is code, a template opened inside it nests, and the `}` that closes the
 *   substitution is told from an object literal's by counting braces.
 * - A regex literal that does not close on its own line is refused with a
 *   PurityScanError. Nothing is deleted on a guess.
 *
 * What is known to remain, stated as a list of measured shapes and not as a
 * count: a regex literal written directly after `)`, `}` or `]` is still LEXED
 * as a division, because telling those apart needs the parenthesis's own
 * keyword. Since the previous bullet, that mis-lexing no longer deletes: the
 * literal's body is emitted verbatim, and so is everything after it, so the
 * denylists see the line either way. What it can still do is make the scanner
 * treat a quote inside such a literal as opening a string — which also only
 * ever emits MORE text verbatim, never less.
 *
 * This paragraph used to open "The one residual", and that word `one` was
 * false while it stood: the token-boundary hole described in the header — a
 * keyword that follows an identifier across whitespace — was open at the same
 * time, and `)` was in fact the SAFE position, because `)` is what ended the
 * word and let `return` be recognised. It then said the mis-lexing was harmless
 * "unless that body contains a literal `//` or `/*`. No guarded module contains
 * either shape." — a residual whose safety rested on a property of today's
 * modules that no test enforced, and that Tasks 6-10 kept adding code to. The
 * list above is therefore what has been measured, not a claim that nothing else
 * is left; the next hole in this file is still likelier to be found by
 * measuring than by reading.
 */
export function stripComments(source) {
  let out = ''
  let i = 0
  // The last significant character emitted, and the identifier it ended, are
  // all that separates a division from a regular expression. `lastRaw` is the
  // last character emitted INCLUDING whitespace, and it is what closes a word:
  // without it `const subject = text` + a newline + `return` builds the word
  // `textreturn`, which is in no keyword list, so `return /re/` lexes as a
  // division and the regex body is read as code.
  let prev = ''
  let prevWord = ''
  let lastRaw = ''

  // Where the character at `i` lives. 'code' is JavaScript; 'template' is the
  // TEXT of a template literal, where nothing but `` ` ``, `\` and `${` means
  // anything. `stack` is what makes them nest: entering either pushes the mode
  // to come back to, and `braceDepth` counts the `{` the current substitution's
  // code has opened, so its closing `}` is told from an object literal's.
  let mode = 'code'
  let braceDepth = 0
  const stack = []

  const keep = (text) => {
    out += text
    for (const ch of text) {
      if (IDENTIFIER_CHAR.test(ch)) {
        prevWord = IDENTIFIER_CHAR.test(lastRaw) ? prevWord + ch : ch
        prev = ch
      } else if (!/\s/.test(ch)) {
        prev = ch
        prevWord = ''
      }
      lastRaw = ch
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

    if (mode === 'template') {
      if (ch === '\\') {
        keep(source.slice(i, i + 2))
        i += 2
        continue
      }
      if (ch === '`') {
        keep(ch)
        i += 1
        const frame = stack.pop()
        mode = frame.mode
        braceDepth = frame.braceDepth
        continue
      }
      if (ch === '$' && next === '{') {
        keep(source.slice(i, i + 2))
        i += 2
        stack.push({ mode: 'template', braceDepth })
        mode = 'code'
        braceDepth = 0
        continue
      }
      keep(ch)
      i += 1
      continue
    }

    if (ch === "'" || ch === '"') {
      const end = literalEnd(source, i)
      keep(source.slice(i, end))
      i = end
      continue
    }
    if (ch === '`') {
      keep(ch)
      i += 1
      stack.push({ mode, braceDepth })
      mode = 'template'
      continue
    }
    if (ch === '{') {
      keep(ch)
      i += 1
      braceDepth += 1
      continue
    }
    if (ch === '}') {
      const frame = stack[stack.length - 1]
      if (braceDepth === 0 && frame !== undefined && frame.mode === 'template') {
        keep(ch)
        i += 1
        stack.pop()
        mode = 'template'
        braceDepth = frame.braceDepth
        continue
      }
      keep(ch)
      i += 1
      if (braceDepth > 0) braceDepth -= 1
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      // A deleted comment still ended the token before it.
      lastRaw = ' '
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      lastRaw = ' '
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
    if (ch === '/') {
      // Division by the rule above, and `next` is neither `/` nor `*`, so the
      // comment branches have already had their say. The reading only matters
      // when the two disagree about what survives, and they disagree on exactly
      // one thing: a regex literal whose raw text carries `//` or `/*` is
      // emitted whole here, where a division reading would walk into it one
      // character later and delete the rest of the line — or, for `/*` with no
      // `*/` after it, the rest of the file.
      const end = regexLiteralEnd(source, i)
      if (end !== -1) {
        const span = source.slice(i, end)
        if (span.includes('//') || span.includes('/*')) {
          keep(span)
          i = end
          continue
        }
      }
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
 *
 * `Function` sits next to `eval` for the reason `eval` is here at all: it
 * compiles a string, so `Function('return Da' + 'te.now()')` reaches the clock
 * with no denied name anywhere in the module. Measured before it was added —
 * that exact function appended to viewer/atlas39/core/view-state.mjs left the
 * suite green at 19/19 with the constructor on disk.
 */
export const FORBIDDEN_IDENTIFIERS = [
  'window', 'document', 'navigator', 'performance', 'globalThis',
  'localStorage', 'sessionStorage', 'indexedDB', 'process', 'fetch',
  'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask',
  'requestAnimationFrame', 'Date', 'XMLHttpRequest', 'WebSocket', 'require',
  'import', 'crypto', 'eval', 'Function', 'Worker'
]

/** `import … from '…'` and `export … from '…'` both spell this. */
export const MODULE_SPECIFIER = /\bfrom\s*['"]/

/**
 * A `\u` escape in comment-free code. JavaScript allows one inside an
 * IdentifierName, so `\u0044ate.now()` and `\u0064ocument.title` are a real
 * clock and a real DOM read that no `\b<name>\b` rule below can match — both
 * measured green against the denylists, both appended to a guarded module and
 * both left the suite at 19/19. The rule is therefore the escape itself and not
 * a longer list of names: a pure core module has no reason to spell any
 * character that way, in an identifier or in a literal, and none of the four
 * guarded modules does.
 */
export const IDENTIFIER_ESCAPE = /\\u\{?[0-9a-fA-F]/

/** Every rule above, applied to one source text. Returns what it found. */
export function purityViolations(source) {
  const code = stripComments(source)
  const found = []
  for (const token of FORBIDDEN_TOKENS) if (code.includes(token)) found.push(token)
  for (const identifier of FORBIDDEN_IDENTIFIERS) {
    if (new RegExp(`\\b${identifier}\\b`).test(code)) found.push(identifier)
  }
  if (MODULE_SPECIFIER.test(code)) found.push("from '<specifier>'")
  if (IDENTIFIER_ESCAPE.test(code)) found.push('\\u<escape>')
  return found
}
