# How it compares

[Back to the overview](../README.md)

An agent that gets a library wrong usually gets it wrong the same way: it writes an API that was true two majors ago. Several things address that, and they are not interchangeable.

| Approach                    | Where the text comes from  | What checks it                                                                                                             |
| --------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| The library's own docs site | Its maintainers            | Nothing, for your version. A docs site describes latest; your lockfile does not say latest.                                |
| A rules file you wrote      | You, once                  | Nothing, and it ages silently                                                                                              |
| Letting the agent search    | Whatever ranked well today | Nothing. It cannot tell a current answer from a popular old one                                                            |
| A skill the package ships   | Its maintainers            | They do, and it is versioned with the package. This is the best case and it is free — pmcp reads these without an account. |
| A skill from this catalog   | Us                         | Executing its examples against the version it names, before publishing                                                     |

## When a shipped skill is the better answer

If the packages you depend on already ship a `SKILL.md`, use those. They come from the people who wrote the library, they update when it updates, and pmcp serves them to your agent for free. Nothing in the catalog beats a maintainer documenting their own work.

Run `npx -y @modootoday/pmcp list` to see which of your dependencies already do. If that covers you, you are done, and you should not pay us.

## When the docs site is the better answer

You are reading, not delegating. A person deciding how to model a schema wants the whole document, its rationale and its edge cases. A skill is shaped for an agent that needs the right answer to one question in the middle of a task.

## Where we think this earns its price

The catalog is for the packages nobody documented for an agent, where the failure is not "I could not find the docs" but "I found docs for a different version and they looked right".

The concrete claim is narrow: every skill here had its examples run against the version it names, on a date it states, and it was not published if any of them failed. Writing the first one caught three confident claims about a migration that were false in the current release. They were plausible, and a reader would have had no way to check.

## What this is not

- Not a security product. We publish what a package did in our sandbox, which is a record of one run, not a judgement that anything is safe.
- Not a replacement for reading. It answers an agent's question in the middle of work.
- Not exhaustive. A skill covers the mistakes worth stopping, and says at the end what it does not cover.
