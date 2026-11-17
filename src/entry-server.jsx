// Build-time only: renders public routes to static HTML (see scripts/prerender.mjs).
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { AppShell } from "./App.jsx";

export { parseTableCsv } from "./parseCsv.js";

// Plain list of papers so the table's content is in the HTML source.
// The interactive table loads data.csv in the browser and replaces this on mount.
function PaperList({ papers }) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-8">
      <h2>Benchmarks in the survey</h2>
      <ul>
        {papers.map((p) => (
          <li key={p.ID}>
            {p["Paper Link"] ? <a href={p["Paper Link"]}>{p["Paper title"]}</a> : p["Paper title"]}
            {p["General category"] ? ` (${p["General category"]})` : null}
            {p.Summary ? <p>{p.Summary}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function render(url, { papers = [] } = {}) {
  return renderToString(
    <StaticRouter location={url}>
      <AppShell />
      {url === "/table" ? <PaperList papers={papers} /> : null}
    </StaticRouter>,
  );
}
