/**
 * Example: extract a table from a web page.
 *
 * Usage:
 *   node examples/extract-table.js "https://en.wikipedia.org/wiki/List_of_countries_by_GDP_(nominal)"
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const url = process.argv[2] || 'https://en.wikipedia.org/wiki/List_of_countries_by_GDP_(nominal)';

const agent = new KuskusAgent({
  onStep({ step, tool, url: currentUrl }) {
    console.log(`[${step}] ${tool} — ${currentUrl}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Go to ${url} and extract the first data table on the page. ` +
  `Return it as a JSON array of objects where each key is the column header and each value is the cell content. ` +
  `Limit to the first 20 rows.`
);

console.log('\nResult:', result.result);
if (result.data) console.log('\nData:', JSON.stringify(result.data, null, 2));

await agent.close();
