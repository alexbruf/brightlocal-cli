// Node.js usage example.
//
// Run:  BRIGHTLOCAL_API_KEY=your-key node wasm/examples/node-example.mjs
//
// The wrapper masks Go's Node-detection during init so net/http routes through
// Node's global fetch (see the package README for why).

import { createBrightLocal } from "../node.js";

const apiKey = process.env.BRIGHTLOCAL_API_KEY;

const bl = await createBrightLocal();

console.log("build:", bl.version());

if (!apiKey) {
  console.error("\nSet BRIGHTLOCAL_API_KEY to make a live API call.");
  process.exit(0);
}

const result = await bl.locationsSearch(apiKey, {
  query: "Columbia, MO",
  country: "USA",
  limit: 5,
});

console.log(`\nFound ${result.items?.length ?? 0} of ${result.total_count} locations:`);
for (const loc of result.items ?? []) {
  console.log(`  ${loc.id}: ${loc.name} (${loc.city}, ${loc.state})`);
}
