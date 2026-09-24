import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SUBSCRIBE_API_URL } from "./config.js";

const TOPICS = [
  {
    id: "news",
    label: "News",
    hint: "Project announcements, workshop updates, and other news.",
  },
  {
    id: "additions",
    label: "Additions to the table",
    hint: "When a new benchmark entry is merged into the catalog.",
  },
  {
    id: "changes",
    label: "Changes to the table",
    hint: "When an existing table entry is updated.",
  },
];

const FREQUENCIES = [
  {
    id: "immediate",
    label: "Immediately",
    hint: "One email per addition or change as soon as it is merged.",
  },
  {
    id: "daily",
    label: "Daily",
    hint: "One digest per topic each day, when there is something new.",
  },
  {
    id: "weekly",
    label: "Weekly",
    hint: "One digest per topic each Monday (default).",
  },
  {
    id: "monthly",
    label: "Monthly",
    hint: "One digest per topic on the first of each month.",
  },
  {
    id: "yearly",
    label: "Yearly",
    hint: "One digest per topic on January 1.",
  },
];

const FIELD_CLASS =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

export default function Subscribe() {
  const [searchParams] = useSearchParams();
  const banner = useMemo(() => {
    if (searchParams.get("confirmed") === "1") {
      return {
        tone: "ok",
        text: "Subscription confirmed. You’re all set.",
      };
    }
    if (searchParams.get("unsubscribed") === "1") {
      return {
        tone: "ok",
        text: "You have been unsubscribed from all WLCD emails.",
      };
    }
    const err = searchParams.get("error");
    if (err === "invalid_token" || err === "missing_token") {
      return {
        tone: "err",
        text: "That confirmation or unsubscribe link is invalid or expired.",
      };
    }
    return null;
  }, [searchParams]);

  const [email, setEmail] = useState("");
  const [topics, setTopics] = useState(() => new Set(["news", "additions"]));
  const [frequency, setFrequency] = useState("weekly");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("idle"); // idle | pending | updated

  const toggleTopic = (id) => {
    setTopics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!SUBSCRIBE_API_URL) {
      setError(
        "Subscribe API is not configured (set VITE_SUBSCRIBE_API_URL)."
      );
      return;
    }
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    if (topics.size === 0) {
      setError("Select at least one topic.");
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = SUBSCRIBE_API_URL.replace(/\/$/, "") + "/subscribe";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          topics: [...topics],
          frequency,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || `Subscription failed (${response.status})`);
      }
      setStatus(result.status === "updated" ? "updated" : "pending");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscription failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="!mt-0 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        Subscribe
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
        Get email updates about the project. Choose which topics you want — you can
        unsubscribe any time from a link in each email. News is sent when published;
        additions and changes follow the frequency you pick.
      </p>

      {banner ? (
        <div
          className={`mt-6 rounded-md border px-4 py-3 text-sm ${
            banner.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
          role="status"
        >
          {banner.text}
        </div>
      ) : null}

      {status === "pending" ? (
        <div className="mt-8 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
          <p className="font-medium">Check your email to confirm.</p>
          <p className="mt-1">
            We sent a confirmation link to <span className="font-medium">{email}</span>.
            Your subscription is inactive until you confirm. If you don’t see it,
            check your spam folder.
          </p>
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="mt-4 text-sm font-medium text-emerald-800 underline hover:text-emerald-950"
          >
            Subscribe another address
          </button>
        </div>
      ) : status === "updated" ? (
        <div className="mt-8 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
          <p className="font-medium">Preferences updated.</p>
          <p className="mt-1">
            Your topic and frequency selections for{" "}
            <span className="font-medium">{email}</span> were saved.
          </p>
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="mt-4 text-sm font-medium text-emerald-800 underline hover:text-emerald-950"
          >
            Edit again
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-6">
          <div>
            <label htmlFor="subscribe-email" className="block text-sm font-medium text-slate-800">
              Email
            </label>
            <input
              id="subscribe-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={FIELD_CLASS}
              placeholder="you@example.com"
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-slate-800">Topics</legend>
            <p className="mt-1 text-xs text-slate-500">Select one or more.</p>
            <ul className="mt-3 space-y-3">
              {TOPICS.map((topic) => (
                <li key={topic.id}>
                  <label className="flex cursor-pointer gap-3 rounded-md border border-slate-200 bg-white px-3 py-3 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                      checked={topics.has(topic.id)}
                      onChange={() => toggleTopic(topic.id)}
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900">
                        {topic.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">{topic.hint}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-slate-800">
              Frequency for additions &amp; changes
            </legend>
            <p className="mt-1 text-xs text-slate-500">
              Non-immediate options combine updates into one email per topic.
              News is always sent separately when published.
            </p>
            <ul className="mt-3 space-y-3">
              {FREQUENCIES.map((option) => (
                <li key={option.id}>
                  <label className="flex cursor-pointer gap-3 rounded-md border border-slate-200 bg-white px-3 py-3 hover:bg-slate-50">
                    <input
                      type="radio"
                      name="frequency"
                      className="mt-1 h-4 w-4 border-slate-300 text-slate-900 focus:ring-slate-500"
                      checked={frequency === option.id}
                      onChange={() => setFrequency(option.id)}
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">{option.hint}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-md bg-[#1870E0] px-4 py-2 text-sm font-medium text-white hover:bg-[#1560C4] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Subscribing…" : "Subscribe"}
          </button>
        </form>
      )}
    </main>
  );
}
