/**
 * Example: get a summary of a Wikipedia article.
 *
 * Usage:
 *   node examples/wikipedia-summary.js "Borobudur"
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const topic = process.argv[2] || 'Borobudur';

const agent = new KuskusAgent({
  onStep({ step, tool, url }) {
    console.log(`[${step}] ${tool} — ${url}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Go to https://en.wikipedia.org/wiki/${encodeURIComponent(topic)} and extract: ` +
  `the article title, the first paragraph (introduction), and the table of contents sections. ` +
  `Return as a JSON object with "title", "introduction", and "sections" fields.`
);

console.log('\nResult:', result.result);
if (result.data) console.log('\nData:', JSON.stringify(result.data, null, 2));

await agent.close();
