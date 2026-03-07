/**
 * Example: check the weather for a city via Google.
 *
 * Usage:
 *   node examples/weather-check.js "Jakarta"
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const city = process.argv[2] || 'Jakarta';

const agent = new KuskusAgent({
  onStep({ step, tool, url }) {
    console.log(`[${step}] ${tool} — ${url}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Go to google.com, search for "weather in ${city}", and extract the current weather info: ` +
  `temperature, condition (e.g. sunny, cloudy), humidity, wind speed, and the weekly forecast if visible. ` +
  `Return as a JSON object.`
);

console.log('\nResult:', result.result);
if (result.data) console.log('\nData:', JSON.stringify(result.data, null, 2));

await agent.close();
