# normal

Using the pmcp-browser tools, find the title of https://example.org and the text of its first link.

## PASS

- Calls `navigate`, then `snapshot` to get refs, then reads with `read_text` (or the snapshot).
- Reports the title and link text from the page, not from memory.
