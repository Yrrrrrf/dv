/** Executable entrypoint; importing the library never starts the CLI. */
import process from "node:process";
import { main } from "./mod.ts";

process.exitCode = await main();
