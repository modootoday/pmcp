const base = document.documentElement.dataset.basepath ?? "";
const path = location.pathname.slice(base.length);
if (/^\/pricing(?:\/|$)/u.test(path)) {
  const target = new URL(path, "https://pro.pmcp.build");
  target.search = location.search;
  target.hash = location.hash;
  document.querySelector("#moved-link").href = target.href;
  location.replace(target.href);
}
