import { checkDriverRelease, formatSmokeResults } from "./driver-release-smoke.js";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--origin") {
  console.error("Usage: npm run smoke:driver-release -- --origin https://your-promoted-website");
  process.exitCode = 1;
} else {
  try {
    const results = await checkDriverRelease(args[1]);
    console.log(formatSmokeResults(results));
    process.exitCode = results.every(result => result.ok) ? 0 : 1;
  } catch {
    console.error("Invalid origin. Use HTTPS without credentials, a path, query or fragment. HTTP is allowed only for loopback fixtures.");
    process.exitCode = 1;
  }
}
