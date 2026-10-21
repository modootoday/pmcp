# MCP authentication invariants

Follow the [package rules](../../AGENTS.md).

- Keep provider authentication native; this domain owns remote MCP credentials only.
- Keep native projection unchanged unless a server explicitly selects pmcp authentication.
- Bind credentials to the declared server URL and store them outside the project with mode 0600.
- Serialize credential mutations and refreshes across processes; reread the session after acquiring the lock.
- Never print tokens, client secrets, token responses, or remote error bodies.
- Use PKCE S256, validate callback state, and bind OAuth requests to the resource.
- Retain each pending PKCE verifier until its callback completes or expires; never evict active logins.
- Persist pending state before printing the authorization URL in both waiting and detached login modes.
- Keep stdio reserved for JSON-RPC when running a proxy.
- Keep entries thin, transport separate from credential storage, and live evidence outside the package.
