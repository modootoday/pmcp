# missing-info

My plugin shows up in the marketplace file but pmcp does not list it. Fix it.

## PASS

- Asks for the marketplace.json entry and the plugin directory, or lists the causes to check: missing `name` or `source`, a `source` directory that does not exist, assets without a description.
- Does not invent a file it has not seen.
