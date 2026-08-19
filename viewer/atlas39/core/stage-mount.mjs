// ATLAS-39 core / mount guard: the last barrier between renderer output and the
// live document.
//
// The renderer boundary is deliberately a markup STRING — that is what lets
// `node --test` byte-compare the exact bytes the browser draws, and it is what
// ATLAS-40 swaps out. Mounting a string is also the one moment at which a
// hostile page title could become executable DOM, so the shell never hands that
// string to `innerHTML`. It crosses two independent barriers instead:
//
//   1. this module — a pure, allowlist-only scan. Every element name and every
//      attribute name the stage renderer may emit is enumerated below. Anything
//      else — a <script>, an on* handler, an xlink:href, a comment, an unquoted
//      or single-quoted attribute, a raw "<" inside an attribute value — is a
//      REFUSAL, not a sanitisation: nothing is stripped and the mount fails
//      closed, exactly like every other ATLAS gate.
//   2. DOMParser('image/svg+xml') in app.mjs — an inert XML document that runs
//      no script and loads no resource, whose root is then required to be an
//      <svg> in the SVG namespace before it is imported into the live document.
//
// Barrier 1 is pure and DOM-free on purpose: it is therefore provable under
// `node --test` without a headless browser, which is the same rule the rest of
// this ticket follows.
//
// Pure: no IO, no clock, no randomness, no DOM.

/** Every element `renderStage(viewModel, layout, focusState, {})` can emit. */
export const STAGE_ELEMENTS = new Set([
  'svg', 'defs', 'radialGradient', 'stop', 'rect', 'g', 'circle', 'path', 'text', 'title'
])

/**
 * Every attribute those elements can carry. `style` is absent from
 * STAGE_ELEMENTS by design: the shell links its stylesheets and never inlines
 * one, so the standalone golden (which does inline `options.styleCss`) is
 * correctly refused by this guard rather than quietly accepted.
 */
export const STAGE_ATTRIBUTES = new Set([
  'aria-hidden', 'aria-label', 'aria-pressed', 'class', 'cx', 'cy', 'd',
  'data-depth', 'data-edge-id', 'data-node-id', 'data-relation', 'height', 'id',
  'offset', 'r', 'role', 'stop-color', 'tabindex', 'text-anchor', 'viewBox',
  'width', 'x', 'xmlns', 'y'
])

const NAME = /^[A-Za-z][A-Za-z0-9-]*$/
const SPACE = ' \t\n\r'

/**
 * Scans stage markup for anything outside the allowlist above.
 *
 * @param {string} markup output of renderStage()
 * @returns {string|null} a human-readable reason to refuse, or null if the
 *   markup consists solely of allowlisted elements and attributes.
 */
export function stageMarkupViolation(markup) {
  if (typeof markup !== 'string') return 'stage markup is not a string'

  let cursor = 0
  while (cursor < markup.length) {
    const open = markup.indexOf('<', cursor)
    if (open === -1) return null

    let at = open + 1
    const lead = markup[at]
    if (lead === undefined) return `unterminated tag at index ${open}`
    // Comments, CDATA, doctypes and processing instructions are not part of the
    // renderer contract, so their presence is itself the finding.
    if (lead === '!' || lead === '?') return `markup declaration or comment at index ${open}`

    const isClosing = lead === '/'
    if (isClosing) at += 1

    let nameEnd = at
    while (nameEnd < markup.length && !SPACE.includes(markup[nameEnd]) && markup[nameEnd] !== '/' && markup[nameEnd] !== '>') {
      nameEnd += 1
    }
    const element = markup.slice(at, nameEnd)
    if (!NAME.test(element)) return `malformed element name ${JSON.stringify(element)} at index ${open}`
    if (!STAGE_ELEMENTS.has(element)) return `element <${element}> is not on the stage allowlist`
    at = nameEnd

    for (;;) {
      while (at < markup.length && SPACE.includes(markup[at])) at += 1
      if (at >= markup.length) return `unterminated <${element}> tag`
      if (markup[at] === '>') { at += 1; break }
      if (markup[at] === '/') {
        if (markup[at + 1] !== '>') return `malformed self-closing <${element}> tag`
        at += 2
        break
      }
      if (isClosing) return `attribute on closing tag </${element}>`

      let attrEnd = at
      while (attrEnd < markup.length && !SPACE.includes(markup[attrEnd]) && !'=/>'.includes(markup[attrEnd])) {
        attrEnd += 1
      }
      const attribute = markup.slice(at, attrEnd)
      if (!NAME.test(attribute)) return `malformed attribute name ${JSON.stringify(attribute)} on <${element}>`
      // Stated separately from the allowlist so the intent survives any future
      // widening of STAGE_ATTRIBUTES: an event handler is never mountable.
      if (/^on/i.test(attribute)) return `event-handler attribute ${attribute} on <${element}>`
      if (!STAGE_ATTRIBUTES.has(attribute)) return `attribute ${attribute} on <${element}> is not on the stage allowlist`
      if (markup[attrEnd] !== '=') return `attribute ${attribute} on <${element}> has no value`
      if (markup[attrEnd + 1] !== '"') return `attribute ${attribute} on <${element}> is not double-quoted`
      const valueEnd = markup.indexOf('"', attrEnd + 2)
      if (valueEnd === -1) return `unterminated value for ${attribute} on <${element}>`
      if (markup.slice(attrEnd + 2, valueEnd).includes('<')) {
        return `raw "<" inside ${attribute} on <${element}>`
      }
      at = valueEnd + 1
    }

    cursor = at
  }

  return null
}
