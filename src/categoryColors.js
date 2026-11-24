// Box color per general category in the topics treemap, from the slate shades the site's buttons use
// (slate-800, 600, 500, 400). Text on them is white. Expert Knowledge shares the darkest shade with
// Reasoning; the two boxes are not next to each other. Each category keeps its color however the
// paper counts change.
export const TOPIC_CATEGORY_COLORS = {
  Reasoning: "#1D293D",
  "Tasks with reasoning": "#1D293D",
  Linguistics: "#45556C",
  "Cross-lingual tasks": "#62748E",
  "General NLP tasks": "#90A1B9",
  "Expert Knowledge": "#1D293D",
};

// Used for any category that has no color above yet.
export const FALLBACK_TOPIC_COLOR = "#62748E";
