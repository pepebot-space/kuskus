/**
 * Example: search Google and extract the first 5 results.
 *
 * Usage:
 *   node examples/search-google.js "nodejs best practices"
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const query = process.argv[2] || 'lightpanda browser';

const agent = new KuskusAgent({
  screenshotDir: './output/screenshots',
  onStep({ step, tool, url }) {
    console.log(`[${step}] ${tool} — ${url}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Go to google.com, search for "${query}", and extract the title and URL of the first 5 search results. Return them as a JSON array.`
);

console.log('\nResult:', result.result);
if (result.data) console.log('\nData:', JSON.stringify(result.data, null, 2));

await agent.close();
