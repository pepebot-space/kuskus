/**
 * Example: search YouTube and extract video results.
 *
 * Usage:
 *   node examples/youtube-search.js "belajar nodejs"
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const query = process.argv[2] || 'belajar nodejs';

const agent = new KuskusAgent({
  onStep({ step, tool, url }) {
    console.log(`[${step}] ${tool} — ${url}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Go to https://www.youtube.com/results?search_query=${encodeURIComponent(query)} and extract the first 8 video results. ` +
  `For each video get: title, channel name, view count, and URL. ` +
  `Return as a JSON array.`
);

console.log('\nResult:', result.result);
if (result.data) console.log('\nData:', JSON.stringify(result.data, null, 2));

await agent.close();
