// Runs after `vite build`: writes dist/<route>.html with real content and per-page
// meta tags (GitHub Pages serves /cfp from cfp.html with HTTP 200), plus sitemap.xml.
import { execSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SITE = "https://what-llms-can-not-do.org";
const NAME = "What LLMs Can(not) Do";

// Public, indexable routes. Anything not listed (admin, review, confirm, ...) keeps
// the 404.html SPA fallback and so stays out of search engines.
const ROUTES = [
  { path: "/", title: NAME, description: "A living survey of benchmarks that compare large language models with humans." },
  { path: "/table", title: `Benchmark table | ${NAME}`, description: "Searchable table of research benchmarks comparing large language models with humans: tasks, languages, models tested, and who performs better." },
  { path: "/cfp", title: `Call for Papers (COLING 2027 workshop) | ${NAME}`, description: "Call for Papers for the What LLMs Can(not) Do workshop at COLING 2027 in Macau: topics, requirements, paper format, and deadlines." },
  { path: "/contribute", title: `Contribute | ${NAME}`, description: "Add a benchmark or paper comparing LLMs with humans to the What LLMs Can(not) Do survey." },
  { path: "/subscribe", title: `Subscribe | ${NAME}`, description: "Get email updates when new benchmarks comparing LLMs with humans are added." },
  { path: "/leaderboard", title: `Contributor leaderboard | ${NAME}`, description: "Top contributors to the What LLMs Can(not) Do benchmark survey." },
];

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

execSync("vite build --ssr src/entry-server.jsx --outDir dist-ssr --emptyOutDir", { stdio: "inherit" });
const { render, parseTableCsv } = await import(pathToFileURL("dist-ssr/entry-server.js").href);

const template = readFileSync("dist/index.html", "utf8");
const papers = parseTableCsv(readFileSync("public/data.csv", "utf8"));

function setMeta(html, attr, key, value) {
  const re = new RegExp(`(<meta\\s+${attr}="${key.replace(/[:]/g, "\\$&")}"\\s+content=")[^"]*(")`);
  if (!re.test(html)) throw new Error(`prerender: <meta ${attr}="${key}"> not found in index.html`);
  return html.replace(re, `$1${esc(value)}$2`);
}

for (const route of ROUTES) {
  const url = SITE + (route.path === "/" ? "/" : route.path);
  let html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(route.title)}</title>\n    <link rel="canonical" href="${url}" />`)
    .replace('<div id="root"></div>', () => `<div id="root">${render(route.path, { papers })}</div>`);
  html = setMeta(html, "name", "description", route.description);
  html = setMeta(html, "property", "og:title", route.title);
  html = setMeta(html, "property", "og:description", route.description);
  html = setMeta(html, "property", "og:url", url);
  html = setMeta(html, "name", "twitter:title", route.title);
  html = setMeta(html, "name", "twitter:description", route.description);
  const file = route.path === "/" ? "dist/index.html" : `dist${route.path}.html`;
  writeFileSync(file, html);
  console.log(`prerendered ${route.path} -> ${file}`);
}

const urls = ROUTES.map(
  (r) => `  <url><loc>${SITE}${r.path}</loc></url>`,
).join("\n");
writeFileSync(
  "dist/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
);
rmSync("dist-ssr", { recursive: true, force: true });
console.log("wrote dist/sitemap.xml");
