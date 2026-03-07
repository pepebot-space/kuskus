/**
 * Example: navigate to a URL and take a full-page screenshot.
 *
 * Usage:
 *   node examples/screenshot-page.js "https://example.com"
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const url = process.argv[2] || 'https://example.com';

const agent = new KuskusAgent({
  screenshotDir: './output/screenshots',
  onStep({ step, tool, url: currentUrl }) {
    console.log(`[${step}] ${tool} — ${currentUrl}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Go to ${url}, wait for the page to fully load, then take a full-page screenshot. ` +
  `Also extract the page title and meta description if available. ` +
  `Return a JSON object with "title" and "description" fields.`
);

console.log('\nResult:', result.result);
if (result.data) console.log('\nData:', JSON.stringify(result.data, null, 2));

await agent.close();
