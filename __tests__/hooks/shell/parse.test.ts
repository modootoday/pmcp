import { homedir } from "node:os";

import { describe, expect, it } from "vitest";

import { commandsOf } from "../../../src/hooks/shell/classify.js";

// Each step as "program sub" plus where it runs, so a test reads like the script it checks.
const steps = (script: string) =>
  commandsOf(script)?.map((step) => [
    step.argv.slice(0, 2).join(" "),
    step.dir,
  ]);

describe("shell grammar", () => {
  it.each([
    ["a; b", ["a", "b"]],
    ["a && b || c", ["a", "b", "c"]],
    ["a & b", ["a", "b"]],
    ["a | b |& c", ["a", "b", "c"]],
    ["a\nb\n\nc", ["a", "b", "c"]],
    ["! a && b", ["a", "b"]],
    ["time -p a | b", ["a", "b"]],
    ["a &&\n  b", ["a", "b"]],
  ])("splits %j into its commands", (script, programs) => {
    expect(steps(script)?.map(([program]) => program)).toEqual(programs);
  });

  it.each([
    ['git commit -m "a && b; c | d"', ["git commit"]],
    ["echo 'x;y' \"(z)\" a\\;b", ["echo x;y"]],
    ["echo {a,b} && find . -exec rm {} \\;", ["echo {a,b}", "find ."]],
    ['echo "${x%%:*}" ${y:-a b} $((1 + 2))', ["echo ${x%%:*}"]],
    ["arr=(a b c) && echo ${arr[@]}", ["", "echo ${arr[@]}"]],
    ["echo $'a\\nb' $\"c\"", ["echo a\nb"]],
    ["echo a#b # a comment; git push", ["echo a#b"]],
  ])("keeps quoting and expansions inside words: %j", (script, programs) => {
    expect(steps(script)?.map(([program]) => program)).toEqual(programs);
  });

  it("reads redirections as redirections, not words", () => {
    const [push, tail] = commandsOf("git push origin main 2>&1 | tail -1")!;
    expect(push!.argv).toEqual(["git", "push", "origin", "main"]);
    expect(push!.redirects).toEqual([{ op: ">&", fd: "2", target: "1" }]);
    expect(tail!.argv).toEqual(["tail", "-1"]);
    expect(
      commandsOf("cmd &>/dev/null < in.txt >> out <<< text")![0]!.redirects,
    ).toEqual([
      { op: "&>", fd: "", target: "/dev/null" },
      { op: "<", fd: "", target: "in.txt" },
      { op: ">>", fd: "", target: "out" },
      { op: "<<<", fd: "", target: "text" },
    ]);
  });

  it("does not run a here-document body, except the substitutions an unquoted one expands", () => {
    expect(steps("cat <<'EOF' > f.sh\ngit push origin main\nEOF\nls")).toEqual([
      ["cat", ""],
      ["ls", ""],
    ]);
    expect(steps("cat <<-EOF\n\tnow $(git push)\n\tEOF\nls")).toEqual([
      ["git push", ""],
      ["cat", ""],
      ["ls", ""],
    ]);
  });

  it("runs every branch of if, while, until, for, case and function bodies", () => {
    const programs = (script: string) =>
      steps(script)?.map(([program]) => program);
    expect(programs("if a; then b; elif c; then d; else e; fi")).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(programs("while a; do b; done; until c\ndo d\ndone")).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(programs("for d in x y; do git -C $d push; done")).toEqual([
      "git -C",
    ]);
    expect(programs("for ((i = 0; i < 3; i++)); do a; done")).toEqual(["a"]);
    expect(programs('case "$x" in a|b) c;; (*) d ;& e) f;;& esac')).toEqual([
      "c",
      "d",
      "f",
    ]);
    expect(
      programs("[[ -n $x && $y =~ ^(a|b)+$ ]] && (( n > 1 )) && c"),
    ).toEqual(["c"]);
    expect(programs("f() { a; }; function g { b; }; f")).toEqual([
      "a",
      "b",
      "f",
    ]);
  });

  it("runs substitutions, process substitutions and backticks", () => {
    expect(
      steps('echo $(a) "`b`" <(c) >(d) && x=$(e)')?.map(([p]) => p),
    ).toEqual(["a", "b", "c", "d", "echo $()", "e", ""]);
  });

  it("runs the complete lines of a backtick body before the first the shell cannot parse", () => {
    expect(steps('python3 -c "print(`x(`)"')).toEqual([["python3 -c", ""]]);
    expect(steps("echo `git push; fi`")).toEqual([["echo $()", ""]]);
    expect(steps("echo `git push\nfi\ngit tag`")).toEqual([
      ["git push", ""],
      ["echo $()", ""],
    ]);
  });

  it("treats a backslash-newline in a backtick body as one line", () => {
    expect(steps("echo `case k in \\\n`")).toEqual([["echo $()", ""]]);
    expect(steps("echo `git push\ngit tag \\\n; fi`")).toEqual([
      ["git push", ""],
      ["echo $()", ""],
    ]);
  });

  it.each([
    "echo 'unclosed",
    'echo "unclosed',
    "if true; then a",
    "a && && b",
    "( a",
    "a )",
    "echo $(a",
    "{ (( n > 1 )) }",
    "if [[ -n $x ]] then a; fi",
    "case x in a) b",
    "for x in a b; a; done",
    "a; done",
    "a | ! b",
    "{ }",
    "if a; then fi",
    "f() a",
    "> o f() { a; }",
    "echo x=(1)",
    "x=1 > o y=(1)",
    "! && a",
    "x=$(echo ok; fi)",
    "then a",
    "}",
  ])("returns null for %j, which the shell refuses", (script) => {
    expect(commandsOf(script)).toBeNull();
  });

  it.each([
    "time",
    "! ;",
    "a && !",
    "time ! time a",
    "a | time b",
    "declare -a x=(1 2) && local y=(3)",
    "> o y=(1) z=(2)",
    "function g (( 1 ))",
    "function g ( ) { a; }",
    "f()\n{ a; }",
    "case a in b) ;; esac",
    "x=$( ) y=` `",
  ])("reads %j, which the shell accepts", (script) => {
    expect(commandsOf(script)).not.toBeNull();
  });
});

describe("where each command runs", () => {
  it("carries cd through the shell it ran in", () => {
    expect(steps("cd /r && cd pr && git grep -n x ; git push")).toEqual([
      ["git grep", "/r/pr"],
      ["git push", "/r/pr"],
    ]);
    expect(steps("{ cd a; }; git push")).toEqual([["git push", "a"]]);
    expect(steps("cd a; cd ../b; cd -; git push")).toEqual([["git push", "a"]]);
    expect(steps("pushd a && git push; popd; git push")).toEqual([
      ["git push", "a"],
      ["git push", ""],
    ]);
    expect(steps("cd ~/ws && git push; cd && git push")).toEqual([
      ["git push", `${homedir()}/ws`],
      ["git push", homedir()],
    ]);
  });

  it("keeps a cd inside a subshell, pipeline stage or background job there", () => {
    expect(steps("(cd a && git push); git push")).toEqual([
      ["git push", "a"],
      ["git push", ""],
    ]);
    expect(steps("cd a | cat; git push")).toEqual([
      ["cat", ""],
      ["git push", ""],
    ]);
    expect(steps("cd a & git push")).toEqual([["git push", ""]]);
    expect(steps("x=$(cd a && pwd); git push")).toEqual([
      ["pwd", "a"],
      ["", ""],
      ["git push", ""],
    ]);
  });

  it("starts substitutions and nested shells where the command is", () => {
    expect(steps("cd a && echo $(git push)")).toEqual([
      ["git push", "a"],
      ["echo $()", "a"],
    ]);
    expect(steps("cd a && bash -c 'cd b && git push'")).toEqual([
      ["git push", "a/b"],
    ]);
  });

  it("gives a new shell only the exported variables and its own NAME=value words", () => {
    const pushDir = (script: string) =>
      commandsOf(script)!.find((step) => step.argv[1] === "push")!.dir;
    expect(pushDir("W=/w; bash -c 'cd $W && git push'")).toBe("$W");
    expect(pushDir("export W=/w; bash -c 'cd $W && git push'")).toBe("/w");
    expect(pushDir("W=/w; export W; sh -c 'cd $W && git push'")).toBe("/w");
    expect(pushDir("W=/w bash -c 'cd $W && git push'")).toBe("/w");
    expect(pushDir('W=/w; bash -c "cd $W && git push"')).toBe("/w");
  });

  it("expands variables the script set to plain text, and only those", () => {
    expect(steps("S=/tmp/s; cd $S/repo && git push")).toEqual([
      ["", ""],
      ["git push", "/tmp/s/repo"],
    ]);
    expect(steps('export R="${S:-x}"; cd "$R" && git push')).toEqual([
      ["export R=${S:-x}", ""],
      ["git push", "$R"],
    ]);
    expect(steps("S=/x; cd '$S' && git push")).toEqual([
      ["", ""],
      ["git push", "$S"],
    ]);
    const push = commandsOf("W=/tmp/t; git -C $W push -q origin HEAD:main")!;
    expect(push[1]!.argv).toEqual([
      "git",
      "-C",
      "/tmp/t",
      "push",
      "-q",
      "origin",
      "HEAD:main",
    ]);
    expect(commandsOf("F=.env; cat < $F")![1]!.redirects).toEqual([
      { op: "<", fd: "", target: ".env" },
    ]);
    expect(
      steps("D=/x; for D in a b; do cd $D; git push; done; read D; cd $D"),
    ).toEqual([
      ["", ""],
      ["git push", "$D"],
      ["read D", "$D"],
    ]);
    expect(steps("D=/x git status; cd $D && git push")).toEqual([
      ["git status", ""],
      ["git push", "$D"],
    ]);
    expect(steps("D=/x; D=$(pwd); cd $D && git push")).toEqual([
      ["", ""],
      ["pwd", ""],
      ["", ""],
      ["git push", "$D"],
    ]);
  });
});
