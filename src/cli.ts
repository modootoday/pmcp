#!/usr/bin/env node
import { endQuietlyOnClosedPipe } from "./cli/pipe.js";
import { dispatch } from "./commands/index.js";

endQuietlyOnClosedPipe([process.stdout, process.stderr]);
process.exitCode = await dispatch(process.argv.slice(2));
