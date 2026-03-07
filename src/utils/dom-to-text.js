import { convert } from 'html-to-text';

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'label']);

/**
 * Convert an HTML string to a compact readable text representation
 * suitable for LLM context. Annotates interactive elements.
 *
 * @param {string} html
 * @param {object} options
 * @param {number} options.maxLength  max output chars (default 8000)
 * @returns {string}
 */
export function htmlToReadableText(html, { maxLength = 8000 } = {}) {
  // Strip script/style/noscript/svg blocks first
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const text = convert(cleaned, {
    wordwrap: false,
    selectors: [
      { selector: 'a', format: 'linkFormatter' },
      { selector: 'img', format: 'skip' },
      { selector: 'head', format: 'skip' },
      { selector: 'nav', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
      { selector: 'h1', options: { uppercase: false } },
      { selector: 'h2', options: { uppercase: false } },
      { selector: 'h3', options: { uppercase: false } },
      { selector: 'button', format: 'buttonFormatter' },
      { selector: 'input', format: 'inputFormatter' },
      { selector: 'select', format: 'selectFormatter' },
    ],
    formatters: {
      linkFormatter(elem, walk, builder, formatOptions) {
        const href = elem.attribs?.href || '';
        builder.openBlock();
        walk(elem.children, builder);
        const text = builder.closeBlock();
        // Only include non-empty, non-JS links
        if (text.trim() && href && !href.startsWith('javascript:')) {
          builder.addInline(`[LINK: ${text.trim()} → ${href}]`);
        } else if (text.trim()) {
          builder.addInline(text.trim());
        }
      },
      buttonFormatter(elem, walk, builder) {
        builder.openBlock();
        walk(elem.children, builder);
        const text = builder.closeBlock();
        if (text.trim()) builder.addInline(`[BUTTON: ${text.trim()}]`);
      },
      inputFormatter(elem, walk, builder) {
        const type = elem.attribs?.type || 'text';
        const placeholder = elem.attribs?.placeholder || '';
        const value = elem.attribs?.value || '';
        const name = elem.attribs?.name || elem.attribs?.id || '';
        if (type === 'hidden') return;
        let repr = `[INPUT(${type})`;
        if (name) repr += ` name="${name}"`;
        if (placeholder) repr += ` placeholder="${placeholder}"`;
        if (value) repr += ` value="${value}"`;
        repr += ']';
        builder.addInline(repr);
      },
      selectFormatter(elem, walk, builder) {
        const name = elem.attribs?.name || elem.attribs?.id || '';
        builder.addInline(`[SELECT${name ? ` name="${name}"` : ''}]`);
      },
    },
  });

  const trimmed = text.replace(/\n{3,}/g, '\n\n').trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) + '\n...[truncated]' : trimmed;
}
