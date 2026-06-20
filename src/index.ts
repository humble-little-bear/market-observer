#!/usr/bin/env node
// Entry point. Dispatches to the CLI.
import { main } from "./cli.js";

main(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[fatal]", err);
  process.exit(1);
});
