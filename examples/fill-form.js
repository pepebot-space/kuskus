/**
 * Example: fill out a web form.
 *
 * Usage:
 *   node examples/fill-form.js
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const agent = new KuskusAgent({
  onStep({ step, tool, url }) {
    console.log(`[${step}] ${tool} — ${url}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Go to https://httpbin.org/forms/post, fill in the customer name as "Kuskus Bot", the telephone as "0812345678", choose pizza size "Large", add topping "Cheese", and take a screenshot before submitting. Do NOT submit the form.`
);

console.log('\nResult:', result.result);
await agent.close();
