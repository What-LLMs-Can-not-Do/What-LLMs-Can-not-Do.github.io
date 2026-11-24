// Layout for the topics treemap: one box per general category, sized by its number of papers,
// split into one box per keyword, sized by the number of papers with that keyword.
//
// Each category is laid out in one of two ways:
// 1. every keyword gets its own box, if every label fits (measured in the page font);
// 2. otherwise the keywords used by only one paper share a single listing box, and every other
//    keyword keeps its own box, its label placed at the smallest font even if it does not fully fit.
//
// Labels wrap at spaces and existing hyphens, split a word at a syllable break only when it is wider than
// the box, and shrink before giving up.
// Text is measured with a measure(text, sizePx, bold) function supplied by the page.
import { splitKeywords } from "./parseCsv.js";

// Keywords that tag almost every paper or repeat a category name, so they carry no topic signal.
const GENERIC_KEYWORDS = new Set(["Text", "Reasoning"]);

export const HEADER_HEIGHT = 34;
const GAP = 4;
// Inner padding of keyword boxes and category headers, in pixels.
export const BOX_PADDING = 6;
export const HEADER_PADDING = 8;
// Font sizes in pixels tried from largest to smallest.
const LABEL_FONT_SIZES = [13, 12, 11, 10];
const HEADER_FONT_SIZES = [16, 15, 14, 13, 12];
export const COUNT_FONT_SIZE = 12;
// Space in pixels between a keyword name and its count when the count sits beside the name.
export const COUNT_GAP = 4;
export const LINE_HEIGHT = 1.2;

/** Keywords of a paper that are used for the topic overview (generic ones removed). */
export function topicKeywords(row) {
  return splitKeywords(row.Keywords).filter((keyword) => !GENERIC_KEYWORDS.has(keyword));
}

/** Worst aspect ratio of a row of areas laid along a side of the given length (lower is squarer). */
function worstRatio(areas, side) {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/**
 * Squarified treemap: split rect into one rectangle per value, keeping them close to square.
 * Values must be sorted largest first; rectangles come back in the same order.
 */
function squarify(values, rect) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return values.map(() => ({ ...rect, w: 0, h: 0 }));
  const areas = values.map((value) => (value * rect.w * rect.h) / total);
  const out = [];
  let { x, y, w, h } = rect;
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(w, h);
    const row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worstRatio([...row, areas[j]], side) <= worstRatio(row, side)) {
      row.push(areas[j]);
      j++;
    }
    const rowSum = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      // Lay the row as a column on the left.
      const colW = rowSum / h;
      let cy = y;
      for (const area of row) {
        out.push({ x, y: cy, w: colW, h: area / colW });
        cy += area / colW;
      }
      x += colW;
      w -= colW;
    } else {
      // Lay the row along the top.
      const rowH = rowSum / w;
      let cx = x;
      for (const area of row) {
        out.push({ x: cx, y, w: area / rowH, h: rowH });
        cx += area / rowH;
      }
      y += rowH;
      h -= rowH;
    }
    i = j;
  }
  return out;
}

/** Return the rectangle shrunk by d on every side. */
function inset(rect, d) {
  return { x: rect.x + d, y: rect.y + d, w: Math.max(0, rect.w - 2 * d), h: Math.max(0, rect.h - 2 * d) };
}

/** Sort groups by number of papers (largest first), then alphabetically by name. */
function bySizeThenName(a, b) {
  return b.papers.length - a.papers.length || a.name.localeCompare(b.name);
}

/** Group papers by a key function that returns one or several names per paper. */
function groupPapers(papers, namesOf) {
  const groups = new Map();
  for (const paper of papers) {
    for (const name of namesOf(paper)) {
      if (!groups.has(name)) groups.set(name, { name, papers: [] });
      groups.get(name).papers.push(paper);
    }
  }
  return [...groups.values()].sort(bySizeThenName);
}

const VOWELS = "aeiouy";
// Consonant pairs that are never split across lines.
const CONSONANT_PAIRS = new Set(["ch", "ck", "gh", "ng", "ph", "qu", "sh", "th", "wh"]);
// Fewest letters kept on each side of a hyphenation break.
const MIN_HYPHEN_PART = 3;

/**
 * Syllable break positions in a word, from a simple English rule: break before a single consonant
 * between vowels (an-no-ta-tion) and between two consonants (clas-si-fi-ca-tion), keeping
 * consonant pairs such as "ch" or "ng" together. Returns indices where the word may be split.
 */
function hyphenationPoints(word) {
  const lower = word.toLowerCase();
  const isVowel = (i) => VOWELS.includes(lower[i]);
  const points = [];
  for (let i = MIN_HYPHEN_PART; i <= lower.length - MIN_HYPHEN_PART; i++) {
    const consonantRun = !isVowel(i - 1) && !isVowel(i);
    const beforeSingleConsonant = isVowel(i - 1) && !isVowel(i) && isVowel(i + 1);
    const splitsPair = CONSONANT_PAIRS.has(lower.slice(i - 1, i + 1));
    if ((consonantRun || beforeSingleConsonant) && !splitsPair) points.push(i);
  }
  return points;
}

/**
 * Split a word that is too wide into hyphenated pieces, each no wider than maxWidth, taking the longest
 * piece that fits each time. Returns null if some part cannot be split narrowly enough.
 */
function hyphenate(word, maxWidth, size, bold, measure) {
  const pieces = [];
  let rest = word;
  while (measure(rest, size, bold) > maxWidth) {
    const offset = word.length - rest.length;
    const points = hyphenationPoints(word)
      .map((point) => point - offset)
      .filter((point) => point >= MIN_HYPHEN_PART && point <= rest.length - MIN_HYPHEN_PART);
    const fitting = points.filter((point) => measure(`${rest.slice(0, point)}-`, size, bold) <= maxWidth);
    if (!fitting.length) return null;
    const point = fitting[fitting.length - 1];
    pieces.push(`${rest.slice(0, point)}-`);
    rest = rest.slice(point);
  }
  return [...pieces, rest];
}

/**
 * Wrap text into lines no wider than maxWidth, breaking at spaces and after hyphens, and hyphenating
 * a word at a syllable break only when it is wider than a whole line. Returns null if it cannot fit.
 */
function wrapText(text, maxWidth, size, bold, measure) {
  const words = text.split(/(?<=-)|\s+/).filter(Boolean);
  const tokens = [];
  for (const word of words) {
    if (measure(word, size, bold) <= maxWidth) {
      tokens.push(word);
      continue;
    }
    const pieces = hyphenate(word, maxWidth, size, bold, measure);
    if (!pieces) return null;
    tokens.push(...pieces);
  }
  const lines = [];
  let line = "";
  for (const token of tokens) {
    const candidate = line ? `${line}${line.endsWith("-") ? "" : " "}${token}` : token;
    if (!line || measure(candidate, size, bold) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = token;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Largest font size at which a keyword name (wrapped) and its paper count fit the box. At each size the count
 * goes on its own line below the name if there is room, otherwise beside the last line of the name.
 * Returns { size, lines, inline }, or null if it does not fit even at the smallest size; with force,
 * returns the smallest size instead of null.
 */
function fitKeywordLabel(name, count, rect, measure, force) {
  const width = rect.w - 2 * BOX_PADDING;
  const height = rect.h - 2 * BOX_PADDING;
  const countWidth = COUNT_GAP + measure(String(count), COUNT_FONT_SIZE, false);
  const lastLineFits = (lines, size) => measure(lines[lines.length - 1], size, true) + countWidth <= width;
  for (const size of LABEL_FONT_SIZES) {
    const lines = wrapText(name, width, size, true, measure);
    if (!lines) continue;
    const nameHeight = lines.length * size * LINE_HEIGHT;
    if (nameHeight + COUNT_FONT_SIZE * LINE_HEIGHT <= height) return { size, lines, inline: false };
    // Beside the name, the last line is as tall as the larger of the two fonts.
    const inlineHeight = nameHeight + (Math.max(size, COUNT_FONT_SIZE) - size) * LINE_HEIGHT;
    if (inlineHeight <= height && lastLineFits(lines, size)) return { size, lines, inline: true };
  }
  if (!force) return null;
  const size = LABEL_FONT_SIZES[LABEL_FONT_SIZES.length - 1];
  const lines = wrapText(name, width, size, true, measure) ?? [name];
  return { size, lines, inline: lastLineFits(lines, size) };
}

/**
 * Header text for a category box: the name followed by its paper count as "(n)", at the largest font size
 * that fits the width. Returns { size, name, count }. The count is always shown; if even the smallest size
 * is too wide, the page cuts the name short instead.
 */
function fitHeader(name, n, width, measure) {
  const room = width - 2 * HEADER_PADDING;
  const count = `(${n})`;
  const size =
    HEADER_FONT_SIZES.find((candidate) => measure(`${name} ${count}`, candidate, true) <= room) ??
    HEADER_FONT_SIZES[HEADER_FONT_SIZES.length - 1];
  return { size, name, count };
}

/** Build a category's keyword boxes inside area, optionally merging the keywords used by one paper. */
function keywordBoxes(groups, area, mergeSingles, measure) {
  const isSingle = (group) => mergeSingles && group.papers.length === 1;
  const items = groups
    .filter((group) => !isSingle(group))
    .map((group) => ({ kind: "keyword", keywords: [group.name], papers: group.papers, size: group.papers.length }));
  const singles = groups.filter(isSingle);
  if (singles.length) {
    items.push({
      kind: "singles",
      keywords: singles.map((group) => group.name).sort((a, b) => a.localeCompare(b)),
      papers: [...new Set(singles.flatMap((group) => group.papers))],
      size: singles.length,
    });
  }
  items.sort((a, b) => b.size - a.size);
  const rects = squarify(items.map((item) => item.size), area);
  return items.map((item, index) => {
    const rect = inset(rects[index], GAP / 2);
    const label = item.kind === "keyword" ? fitKeywordLabel(item.keywords[0], item.size, rect, measure, mergeSingles) : null;
    return { ...item, rect, label };
  });
}

/** Whether every keyword label fits; the "Other keywords" box scrolls its list, so it always counts as fitting. */
function allLabelsFit(boxes) {
  return boxes.every((box) => box.kind === "singles" || box.label);
}

/**
 * Lay out the whole treemap for the given pixel size, measuring text with measure(text, sizePx, bold).
 * Returns one entry per category: { category, papers, rect, header, boxes }, where header is
 * { size, name, count } and each box is { kind: "keyword" | "singles", keywords, papers, size, rect, label }
 * with label { size, lines, inline } for keyword boxes (inline: the count sits beside the last line).
 */
export function layoutTreemap(rows, width, height, measure) {
  const categories = groupPapers(rows, (row) => [row["General category"]?.trim() || "Uncategorized"]);
  const rects = squarify(
    categories.map((cat) => cat.papers.length),
    { x: 0, y: 0, w: width, h: height }
  );
  return categories.map((cat, index) => {
    const rect = inset(rects[index], GAP / 2);
    const body = {
      x: rect.x + GAP,
      y: rect.y + HEADER_HEIGHT,
      w: Math.max(0, rect.w - 2 * GAP),
      h: Math.max(0, rect.h - HEADER_HEIGHT - GAP),
    };
    const groups = groupPapers(cat.papers, topicKeywords);
    let boxes = keywordBoxes(groups, body, false, measure);
    if (!allLabelsFit(boxes)) boxes = keywordBoxes(groups, body, true, measure);
    const header = fitHeader(cat.name, cat.papers.length, rect.w, measure);
    return { category: cat.name, papers: cat.papers, rect, header, boxes };
  });
}
