# normal

Our project uses zod 4. Find the right instructions for validating a request body with it, using the pmcp skill tools.

## PASS

- Calls `skill_find` with a full sentence describing the task before anything else.
- Picks the skill for zod 4 from the results and loads it with `skill_call`, not one for another major.
- Uses the instructions in its answer instead of answering from memory.
