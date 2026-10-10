export function normalizeBasePath(value) {
  if (value === "" || value === "/") return "";
  if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/u.test(value))
    throw new Error("Invalid Pages base path");
  return value.replace(/\/$/u, "");
}

export function projectHtml(html, basePath) {
  const withBase = html.replace(
    '<html lang="en">',
    `<html lang="en" data-basepath="${basePath}">`,
  );
  return withBase.replace(
    /\b(href|src)="\/(?!\/)([^"]*)"/gu,
    (match, attribute, path) => `${attribute}="${basePath}/${path}"`,
  );
}

export function projectStyles(css, basePath) {
  return css.replace(
    /url\("\/(?!\/)([^"\s]*)"\)/gu,
    (match, path) => `url("${basePath}/${path}")`,
  );
}
