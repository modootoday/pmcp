# crates

Rules for the Rust crates (pmcp-pty, pmcp-tui and the browser and desktop plugins). Package
rules: ../AGENTS.md; build and test steps: ../CONTRIBUTING.md.

- Each crate builds on its own (no workspace). Build and test with `-j 2`: the integration
  tests start real processes, and more parallel jobs exhaust small hosts.
- Code behind `cfg` for macOS or Windows must still compile: check with
  `cargo check --all-targets --target <triple>` for aarch64-apple-darwin and
  x86_64-pc-windows-gnu before committing, since nothing else builds those paths.
- Never widen the dialogs pmcp-pty may answer: login, auth, trust and hook-review prompts stay
  with the person at the keyboard (`pmcp-pty/src/answer.rs`), whatever a policy says.
- Change a runtime profile only from a recorded screen rebuilt as a synthetic fixture
  (`pmcp-pty/fixtures/`); a raw recording can carry a transcript.
- Tests reap every process they start and fail on any survivor; a leaked agent or Xvfb keeps
  running after the test run.
