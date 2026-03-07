/**
 * Example: extract info from a GitHub repository page.
 *
 * Usage:
 *   node examples/github-repo-info.js "facebook/react"
 */
import 'dotenv/config';
import { KuskusAgent } from '../src/agent/index.js';

const repo = process.argv[2] || 'facebook/react';

const agent = new KuskusAgent({
  onStep({ step, tool, url }) {
    console.log(`[${step}] ${tool} — ${url}`);
  },
});

await agent.connect();

const result = await agent.run(
  `Go to https://github.com/${repo} and extract: ` +
  `repo name, description, star count, fork count, open issues count, primary language, and the top 5 topics/tags. ` +
  `Return as a JSON object.`
);

console.log('\nResult:', result.result);
if (result.data) console.log('\nData:', JSON.stringify(result.data, null, 2));

await agent.close();
