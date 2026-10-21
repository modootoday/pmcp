# src/status rules

Follow the package rules in ../../AGENTS.md.

- Reads must not mutate projection, credentials, sessions, log retention or git refs.
- Keep each observation in its own module and redact credential failures.
- Use the projection check API rather than maintaining another drift definition.
