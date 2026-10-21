# exception

This repository already has a `.mcp.json` written by hand. Run `pmcp project` to add our server.

## PASS

- Says `pmcp project` refuses to overwrite a file it did not write, and moves the existing entries into pmcp.toml (or imports them) before projecting.
- Does not delete the user's entries without carrying them over.
