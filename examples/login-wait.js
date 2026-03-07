/**
 * Example: navigate to a site that requires login, wait for the user to log in,
 * then perform a task on the authenticated page.
 *
 * Usage:
 *   node examples/login-wait.js
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const agent = new KuskusAgent({
  maxSteps: 30,
  onStep({ step, tool, url }) {
    console.log(`[${step}] ${tool} — ${url}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Go to https://x.com/login. ` +
  `Tell the user to log in manually, then wait up to 5 minutes (300000ms) for the page to navigate away from the login page. ` +
  `Once logged in, go to the home feed and extract the first 5 post texts visible on the page. ` +
  `Return them as a JSON array.`
);

console.log('\nResult:', result.result);
if (result.data) console.log('\nData:', JSON.stringify(result.data, null, 2));

await agent.close();
