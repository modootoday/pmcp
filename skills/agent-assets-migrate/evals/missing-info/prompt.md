# missing-info

Migrate this repository's agent files to pmcp. The CLAUDE.md says "always run the linter" and the GEMINI.md says "run the linter only on changed files". Nothing else is given.

## PASS

- Does not pick one rule silently or summarise them into a new one.
- Says the two rules conflict and asks which holds, or checks the code (for example the lint script) and states what it found.
- Records the decision in its report.
