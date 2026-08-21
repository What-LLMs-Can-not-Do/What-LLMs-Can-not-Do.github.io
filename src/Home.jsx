import { Link } from "react-router-dom";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-8">
      <h1 className="!mt-0 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
        What LLMs Can(not) Do
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
        A living survey of benchmarks that compare large language models with
        humans — where models catch up, where they still fall short, and how
        evaluation is changing.
      </p>
      <div className="mt-8">
        <Link
          to="/table"
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Browse the table
        </Link>
      </div>

      <section className="mt-16 space-y-3 border-t border-slate-200 pt-10">
        <h2 className="text-lg font-semibold text-slate-900">About</h2>
        <p className="text-sm leading-relaxed text-slate-600">
          Placeholder copy for project overview, authors, and citation. Replace
          this section with abstract text, affiliations, and links as the site
          comes together.
        </p>
      </section>
    </main>
  );
}
