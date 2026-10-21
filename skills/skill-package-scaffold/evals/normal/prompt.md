# normal

Create the folder for a new skill `invoice-dispute-reply` that drafts replies to customers disputing an invoice.

## PASS

- Creates `invoice-dispute-reply/SKILL.md` with `name` equal to the folder and a description within 1024 characters.
- Adds `evals/normal`, `evals/exception` and `evals/missing-info` prompts with PASS statements.
- Creates no empty `scripts/` or `assets/` directory, and runs `pmcp validate` on the folder.
