/**
 * Example: search for a place on Google Maps and extract its info.
 *
 * Usage:
 *   node examples/google-maps-place.js "Monas Jakarta"
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const place = process.argv[2] || 'Monas Jakarta';

const agent = new KuskusAgent({
  maxSteps: 25,
  onStep({ step, tool, url }) {
    console.log(`[${step}] ${tool} — ${url}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Go to https://www.google.com/maps/search/${encodeURIComponent(place)} and extract info about the place: ` +
  `name, address, rating, review count, opening hours if visible, and phone number if available. ` +
  `Return as a JSON object.`
);

console.log('\nResult:', result.result);
if (result.data) console.log('\nData:', JSON.stringify(result.data, null, 2));

await agent.close();
