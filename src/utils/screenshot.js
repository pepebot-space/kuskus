import fs from 'fs/promises';
import path from 'path';

/**
 * Save a base64 screenshot to disk.
 * @param {string} base64Data
 * @param {string} dir
 * @param {string} filename
 * @returns {Promise<string>} absolute path written
 */
export async function saveScreenshot(base64Data, dir, filename) {
  await fs.mkdir(dir, { recursive: true });
  const filepath = path.resolve(dir, filename);
  await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
  return filepath;
}

/**
 * Build a timestamped filename for a step screenshot.
 * @param {number} step
 * @returns {string}
 */
export function screenshotFilename(step) {
  const ts = Date.now();
  return `step-${String(step).padStart(3, '0')}-${ts}.png`;
}
