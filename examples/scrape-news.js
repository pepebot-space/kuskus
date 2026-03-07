/**
 * Example: scrape top headlines from a news site.
 *
 * Usage:
 *   node examples/scrape-news.js "https://news.ycombinator.com"
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const url = process.argv[2] || 'https://news.ycombinator.com';

const agent = new KuskusAgent({
  onStep({ step, tool, url: currentUrl }) {
    console.log(`[${step}] ${tool} — ${currentUrl}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Go to ${url} and extract the top 10 article headlines with their links. ` +
  `Return as a JSON array with "title" and "url" fields.`
);

console.log('\nResult:', result.result);
if (result.data) console.log('\nData:', JSON.stringify(result.data, null, 2));

await agent.close();
