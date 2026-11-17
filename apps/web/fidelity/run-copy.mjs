// pnpm --filter web fidelity:copy <C-0x file> <route> [state-json]
//   e.g. pnpm --filter web fidelity:copy C-02-Treasuries "/treasuries/?mockWallet=owner" '{"view":"compare"}'
// state-json is the prototype's state; its "$props" key (if any) holds prop overrides: '{"$props":{"viewerIsFounder":false}}'.
// Only default and "$props" states can be set here; states reached by clicking are driven in each screen's own spec.
import { spawnSync } from "node:child_process";

const [file, route, stateArg] = process.argv.slice(2);
if (!file || !route) {
  console.error('usage: pnpm --filter web fidelity:copy <C-0x file> <route> [state-json]\n  e.g. fidelity:copy C-02-Treasuries "/treasuries/" \'{"view":"compare"}\'');
  process.exit(2);
}

let parsed = {};
try {
  parsed = stateArg ? JSON.parse(stateArg) : {};
} catch {
  console.error(`state-json is not valid JSON: ${stateArg}`);
  process.exit(2);
}
const { $props: props = {}, ...state } = parsed;

// The three mobile prototype files are checked in the 390px dark project; the rest at 1280 light.
const project = /^C-(M\d|Mobile)/.test(file) ? "mobile-dark" : "desktop-light";

const result = spawnSync("pnpm", ["exec", "playwright", "test", "fidelity/copy.spec.ts", `--project=${project}`], {
  stdio: "inherit",
  env: {
    ...process.env,
    FIDELITY_FILE: file,
    FIDELITY_ROUTE: route,
    FIDELITY_STATE: JSON.stringify(state),
    FIDELITY_PROPS: JSON.stringify(props),
  },
});
process.exit(result.status ?? 1);
