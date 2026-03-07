/**
 * Example: open multiple tabs and collect data from each.
 *
 * Usage:
 *   node examples/multi-tab.js
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const agent = new KuskusAgent({
  maxSteps: 40,
  onStep({ step, tool, url }) {
    console.log(`[${step}] ${tool} — ${url}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Open two browser tabs. ` +
  `In the first tab, go to https://news.ycombinator.com and get the top 5 headlines. ` +
  `In the second tab, go to https://lobste.rs and get the top 5 headlines. ` +
  `Switch back to the first tab when done with the second. ` +
  `Return a JSON object with two keys: "hackernews" and "lobsters", each containing an array of headline strings.`
);

console.log('\nResult:', result.result);
if (result.data) console.log('\nData:', JSON.stringify(result.data, null, 2));

await agent.close();
