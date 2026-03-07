/**
 * Example: search for a product on Tokopedia and extract prices.
 *
 * Usage:
 *   node examples/product-price-check.js "mechanical keyboard"
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const query = process.argv[2] || 'mechanical keyboard';

const agent = new KuskusAgent({
  onStep({ step, tool, url }) {
    console.log(`[${step}] ${tool} — ${url}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Go to https://www.tokopedia.com/search?st=product&q=${encodeURIComponent(query)} and extract the first 10 products. ` +
  `For each product get: name, price, shop name, and rating if available. ` +
  `Return as a JSON array.`
);

console.log('\nResult:', result.result);
if (result.data) console.log('\nData:', JSON.stringify(result.data, null, 2));

await agent.close();
