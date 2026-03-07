import { convert } from 'html-to-text';

/**
 * Convert an HTML string to a compact readable text representation
 * suitable for LLM context.
 *
 * @param {string} html
 * @param {object} options
 * @param {number} options.maxLength  max output chars (default 8000)
 * @returns {string}
 */
export function htmlToReadableText(html, { maxLength = 8000 } = {}) {
  // Strip noisy tags first
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const text = convert(cleaned, {
    wordwrap: false,
    selectors: [
      // Links: show text + href
      {
        selector: 'a',
        options: { linkBrackets: false, baseUrl: '' },
      },
      // Skip images
      { selector: 'img', format: 'skip' },
      { selector: 'head', format: 'skip' },
      // Inputs: show type + name/placeholder
      { selector: 'input[type="hidden"]', format: 'skip' },
      { selector: 'h1', options: { uppercase: false } },
      { selector: 'h2', options: { uppercase: false } },
      { selector: 'h3', options: { uppercase: false } },
      { selector: 'table', options: { uppercaseHeaderCells: false } },
    ],
  });

  const trimmed = text.replace(/\n{3,}/g, '\n\n').trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) + '\n...[truncated]' : trimmed;
}
