import { Link } from "react-router-dom";

const logoSrc = `${import.meta.env.BASE_URL}logo_cropped.png`;

const ORGANIZERS = [
  { name: "Lukas Edman", affiliation: "TU Munich" },
  { name: "Kathy Hämmerl", affiliation: "TU Munich" },
  { name: "Hanna Shcharbakova", affiliation: "TU Munich" },
  { name: "Lisa Bylinina", affiliation: "Utrecht University" },
  { name: "Vilém Zouhar", affiliation: "ETH Zurich" },
  { name: "JiWoo Hwang", affiliation: "TU Munich" },
  { name: "Sophie Henning", affiliation: "TU Munich" },
  { name: "Alexander Fraser", affiliation: "TU Munich" },
  { name: "Maike Züfle", affiliation: "KIT Karlsruhe" },
  { name: "Marianne de Heer Kloots", affiliation: "University of Amsterdam" },
];

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
          LLMs can do a lot these days, but what <em>can&apos;t</em> they do?
          Which tasks can humans still do better? We&apos;re looking to gather
          all of the research into this and make it easily accessible for anyone
          interested.
        </p>
        <p className="text-sm leading-relaxed text-slate-600">
          This project is also aiming to be a workshop at *ACL venues,
          where we will accept submissions on the capabilities of frontier LLMs.
          We&apos;ll keep you posted on that!
        </p>
      </section>

      <section className="mt-12 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Organizers</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {ORGANIZERS.map(({ name, affiliation }) => (
            <li key={name} className="text-sm leading-relaxed text-slate-600">
              <span className="font-medium text-slate-800">{name}</span>
              <span className="text-slate-500"> ({affiliation})</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
