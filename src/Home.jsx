import { Link } from "react-router-dom";

const logoSrc = `${import.meta.env.BASE_URL}logo_cropped.png`;

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-8">
      <h1 className="!mt-0 text-center text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
        What LLMs Can(not) Do
      </h1>
      <img
        src={logoSrc}
        alt="What LLMs Can(not) Do logo: a human beating a robot at rock-paper-scissors"
        className="mx-auto mt-8 w-full max-w-md object-contain"
      />
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
        A living survey of benchmarks that compare large language models with
        humans — where models catch up, where they still fall short, and how
        evaluation is changing.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          to="/table"
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Browse the table
        </Link>
        <Link
          to="/contribute"
          className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Suggest an addition
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
