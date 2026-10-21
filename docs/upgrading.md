# Upgrading

[Back to the overview](../README.md)

What to do when a release changes something you rely on. Each release's notes on GitHub
Releases list its breaking changes and link here.

## From 0.17 to 0.18

0.18 replaces tmux with pmcp's own terminal host, so it does not read tmux groups or views.
Stop what 0.17 started before you upgrade, with the 0.17 release that created it:

```sh
npx @modootoday/pmcp@0.17.4 tui recovery          # a workspace from bare pmcp: prints groupFile and generation
npx @modootoday/pmcp@0.17.4 tui close --view "$VIEW_FILE"
npx @modootoday/pmcp@0.17.4 harness group inspect --group-file "$GROUP_FILE"   # any other group: prints the generation
npx @modootoday/pmcp@0.17.4 harness group stop --group-file "$GROUP_FILE" --generation "$GENERATION"
```

Then upgrade and start a new workspace with `pmcp tui --new` (plain `pmcp` once no 0.17
checkpoint is left). Scripts that called the removed `pmcp tui` view operations now get a
usage error (exit 2). The terminal workspace needs Linux or macOS; see
[Compatibility](compatibility.md).
