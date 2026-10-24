import { Link } from "react-router-dom";

const TIMELINE = [
  { label: "Direct paper submission deadline", date: "February 2027" },
  { label: "Pre-reviewed ARR commitment deadline", date: "February 2027" },
  { label: "Notification of acceptance", date: "March 2027" },
  { label: "Camera-ready paper due", date: "March 2027" },
  { label: "Workshop", date: "Full day, one of May 9–14, 2027" },
];

export default function Cfp() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="!mt-0 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        Call for Papers
      </h1>
      <p className="mt-2 text-base font-medium text-slate-800 sm:text-lg">
        WLCD 2027 – The First Workshop on What LLMs Can(not) Do
      </p>

      <div className="mt-6 space-y-4 text-sm leading-relaxed text-slate-600">
        <p>
          WLCD will be a workshop at COLING in Macau. Our
          goal is to keep track of the abilities of state-of-the-art Large
          Language Models (LLMs) in comparison to humans, and we are looking for
          contributors! At the workshop, expect a program full of invited talks,
          posters, discussions, and ideas.
        </p>
        <p className="!mt-8">
          Read below for details on submitting a paper to the workshop.
          Additionally, if you have a relevant paper that is already published
          from 2025 or later and would fit our{" "}
          <Link to="/table" className="font-medium text-slate-800 underline hover:text-slate-950">
            survey table
          </Link>
          , check out the{" "}
          <Link
            to="/contribute"
            className="font-medium text-slate-800 underline hover:text-slate-950"
          >
            Contribute
          </Link>{" "}
          page.
        </p>
      </div>

      <section className="mt-12 space-y-4 border-t border-slate-200 pt-10">
        <h2 className="text-lg font-semibold text-slate-900">Requirements</h2>
        <div className="flex flex-col gap-4 text-sm leading-relaxed text-slate-600">
          <p>
            The most important requirement is that the paper{" "}
            <strong className="font-medium text-slate-800">
              compares LLMs to humans
            </strong>
            . This can be done in a variety of ways. The best of course is
            having a human baseline, but this is not always feasible. We also
            accept evaluations which are annotated by humans, such as exam
            questions crafted by an expert. The answer should be{" "}
            <strong className="font-medium text-slate-800">objective</strong>, so
            that the LLMs&apos; answers can be fairly evaluated. Evaluations may
            also be considered trivial, such that a reasonable human may be
            expected to get 100% accuracy (e.g., counting the r&apos;s in
            strawberry).
          </p>
          <p>
            For this year, we are limiting the scope to works that satisfy these
            3 requirements:
          </p>
          <ol className="m-0 list-decimal space-y-2 pl-5">
            <li>
              Works on out-of-the-box LLMs, i.e., evaluation requires no
              additional fine-tuning.
            </li>
            <li>
              Evaluations are on natural language, including text and/or speech.
            </li>
            <li>
              Evaluation tasks do not require tool usage, which means no RAG or
              knowledge graphs. If it is not clear if a closed LLM is using a
              tool to solve a task, this is allowed, but should be mentioned in
              the paper.
            </li>
          </ol>
          <p>
            Feel free to email us at{" "}
            <a
              href="mailto:contact@what-llms-can-not-do.org"
              className="font-medium text-slate-800 underline hover:text-slate-950"
            >
              contact@what-llms-can-not-do.org
            </a>{" "}
            if you&apos;re unsure whether your idea meets these requirements.
          </p>
        </div>
      </section>

      <section className="mt-12 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Paper Format</h2>
        <div className="flex flex-col gap-4 text-sm leading-relaxed text-slate-600">
          <p>We accept the following paper formats:</p>
          <ul className="m-0 list-disc space-y-1 pl-5">
            <li>Long papers</li>
            <li>Short papers</li>
            <li>Update papers</li>
          </ul>
          <p>
            All formats can choose to be either{" "}
            <strong className="font-medium text-slate-800">archival</strong> or{" "}
            <strong className="font-medium text-slate-800">non-archival</strong>.
            Long and short papers are your standard 8- or 4-page papers in ACL
            format, following instructions from the template.
          </p>
          <p>
            Update papers are 2–4-page papers that update the findings of older
            works with newer models. Have you tried to replicate existing
            evaluations with SOTA models and found that newer LLMs perform
            better, similarly, or even worse than previously tested models? This
            is the place for you. The format is ACL style, with shorter sections
            overall, including an explanation of the original paper. Additional
            analysis is welcome, but not required.
          </p>
          <p>
            We will accept pre-reviewed submissions from ACL Rolling Review
            (ARR) as well as independently on OpenReview.
          </p>
        </div>
      </section>

      <section className="mt-12 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Tentative Timeline
        </h2>
        <p className="text-sm leading-relaxed text-slate-600">
          All deadlines are at 23:59, Anywhere on Earth.
        </p>
        <dl className="divide-y divide-slate-200 border-y border-slate-200">
          {TIMELINE.map(({ label, date }) => (
            <div
              key={label}
              className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
            >
              <dt className="text-sm text-slate-600">{label}</dt>
              <dd className="shrink-0 text-sm font-medium text-slate-900">
                {date}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
