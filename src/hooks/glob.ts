// A path glob: * within one segment, ** across segments, ? one character. With below, a glob
// naming a directory also covers everything below it.
export function globPattern(glob: string, below = true): RegExp {
  let source = "";
  for (let at = 0; at < glob.length; at += 1) {
    const char = glob[at]!;
    if (char === "*" && glob[at + 1] === "*") {
      const slash = glob[at + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      at += slash ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${source}${below ? "(?:/.*)?" : ""}$`, "u");
}
