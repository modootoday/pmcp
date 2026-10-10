#!/usr/bin/env node
import { dispatch } from "./commands/index.js";

process.exitCode = await dispatch(process.argv.slice(2));
