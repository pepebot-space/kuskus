/**
 * Example: search for flights on Google.
 *
 * Usage:
 *   node examples/search-flight.js "CGK" "HND" "2025-06-01"
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const origin = process.argv[2] || 'CGK';
const destination = process.argv[3] || 'HND';
const date = process.argv[4] || '2025-06-01';

const agent = new KuskusAgent({
  onStep({ step, tool, url }) {
    console.log(`[${step}] ${tool} — ${url}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Go to google.com, search for "flights from ${origin} to ${destination} on ${date}", ` +
  `then extract and summarize the top flight options visible on the page (airline, price, duration). ` +
  `Return the results as a JSON array.`
);

console.log('\nResult:', result.result);
if (result.data) console.log('\nData:', JSON.stringify(result.data, null, 2));

await agent.close();
