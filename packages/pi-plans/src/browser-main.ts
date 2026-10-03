import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { browserOrigin } from "./browser-url.ts";
import { startPlanBrowser } from "./browser-server.ts";

const args = process.argv.slice(2);
const roots: string[] = [];
let port = Number(new URL(browserOrigin()).port || 80);
let dataDir: string | undefined;
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === "--help") { console.log("pi-plans-serve [--port PORT] [--root SESSION_DIRECTORY ...] [--data-dir DIRECTORY]\nStarts one foreground server. Ctrl-C stops it. PI_PLANS_URL sets the default origin."); process.exit(0); }
  if (!["--port", "--root", "--data-dir"].includes(arg ?? "") || !args[index + 1]) throw new Error(`Invalid argument: ${arg}`);
  const value = args[++index]!;
  if (arg === "--port") port = Number(value);
  if (arg === "--root") roots.push(resolve(value));
  if (arg === "--data-dir") dataDir = resolve(value);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be between 1 and 65535");
try {
  const browser = await startPlanBrowser({ port, roots: roots.length ? roots : undefined, dataDir, assetsDir: fileURLToPath(new URL("./web/", import.meta.url)) });
  console.log(`Plan server listening at ${browser.origin}. Open a saved plan link.`);
} catch (error) {
  console.error(`pi-plans-serve: ${(error as NodeJS.ErrnoException).code === "EADDRINUSE" ? `Port ${port} is already in use. Stop the existing listener or choose --port and set PI_PLANS_URL to match.` : String(error)}`);
  process.exitCode = 1;
}
