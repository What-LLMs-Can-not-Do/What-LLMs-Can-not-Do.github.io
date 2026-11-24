import { useEffect, useMemo, useRef, useState } from "react";
import { FALLBACK_TOPIC_COLOR, TOPIC_CATEGORY_COLORS } from "./categoryColors.js";
import { parseTableCsv } from "./parseCsv.js";
import {
  BOX_PADDING,
  COUNT_FONT_SIZE,
  COUNT_GAP,
  HEADER_HEIGHT,
  HEADER_PADDING,
  LINE_HEIGHT,
  layoutTreemap,
  topicKeywords,
} from "./treemapLayout.js";

const asset = (path) => `${import.meta.env.BASE_URL}${path}`;

// Treemap height as a share of its width. It sits in the narrow home page column, so it grows downwards:
// taller than wide on desktop, and taller still on phones so boxes stay readable.
const WIDE_SCREEN_PX = 640;
const WIDE_RATIO = 1.25;
const NARROW_RATIO = 1.8;
// Size of the paper card that opens for a hovered keyword, and its distance from the treemap or box.
// It opens beside the treemap when the page has at least CARD_MIN_WIDTH of free space on one side.
const CARD_WIDTH = 340;
const CARD_MIN_WIDTH = 240;
const CARD_MAX_HEIGHT = 320;
const CARD_GAP = 16;
// How long a hovered card stays open after the mouse leaves the treemap.
const HOVER_CLOSE_DELAY_MS = 400;

/** Treemap height in pixels for a given width. */
function treemapHeight(width) {
  return Math.round(width * (width >= WIDE_SCREEN_PX ? WIDE_RATIO : NARROW_RATIO));
}

/** Track the content width of an element, updating on resize. */
function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => setWidth(Math.floor(element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * Text width measurer in the page font (which the treemap inherits from the body), cached per text,
 * size and weight. Labels are laid out from these widths, so they match what the browser draws.
 */
function createMeasure() {
  const context = document.createElement("canvas").getContext("2d");
  const family = getComputedStyle(document.body).fontFamily;
  const cache = new Map();
  return (text, size, bold) => {
    const key = `${bold ? 1 : 0}|${size}|${text}`;
    if (!cache.has(key)) {
      context.font = `${bold ? 600 : 400} ${size}px ${family}`;
      cache.set(key, context.measureText(text).width);
    }
    return cache.get(key);
  };
}

/** Stable id of a keyword box, so hover and pinning survive a re-layout on resize. */
function boxId(category, box) {
  return `${category}::${box.kind}::${box.keywords.join("|")}`;
}

/** Absolute positioning style for a layout rectangle. */
function placement(rect) {
  return { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
}

/** Plural helper for counts in labels. */
function papersLabel(n) {
  return `${n} paper${n === 1 ? "" : "s"}`;
}

/**
 * Track the free page space (pixels) to the left and right of an element, so the paper card can open
 * outside the treemap. Updates when the window or the element is resized.
 */
function useSideRoom(ref, width) {
  const [room, setRoom] = useState({ left: 0, right: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      setRoom({ left: bounds.left, right: document.documentElement.clientWidth - bounds.right });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [ref, width]);
  return room;
}

/**
 * Card position for a hovered box, never covering the treemap when the page has room: outside the treemap
 * on the side with more free space, level with the box. On narrow screens it opens just below the box
 * (or above it near the bottom), so it covers other boxes but never the hovered one.
 */
function cardPosition(rect, width, height, room) {
  const top = Math.max(0, Math.min(rect.y, height - CARD_MAX_HEIGHT));
  const outsideWidth = Math.max(room.left, room.right) - 2 * CARD_GAP;
  if (outsideWidth >= CARD_MIN_WIDTH) {
    const cardWidth = Math.min(CARD_WIDTH, outsideWidth);
    const left = room.right >= room.left ? width + CARD_GAP : -CARD_GAP - cardWidth;
    return { left, top, width: cardWidth, maxHeight: CARD_MAX_HEIGHT };
  }
  const cardWidth = Math.min(CARD_WIDTH, width);
  const left = Math.max(0, Math.min(rect.x, width - cardWidth));
  const below = rect.y + rect.h + CARD_GAP;
  const fitsBelow = below + CARD_MAX_HEIGHT <= height;
  const verticalPlacement = fitsBelow ? { top: below } : { bottom: height - rect.y + CARD_GAP };
  return { left, ...verticalPlacement, width: cardWidth, maxHeight: CARD_MAX_HEIGHT };
}

/** Id of one keyword inside the box of keywords used only once, so it can be hovered on its own. */
function singleKeywordId(id, keyword) {
  return `${id}::${keyword}`;
}

const BOX_CLASS = "absolute overflow-hidden rounded-md bg-white/15 text-left text-white";

/**
 * "Other keywords" box, listing the keywords used only once: every keyword is its own small button, and only
 * hovering or clicking one shows a card (with just that keyword's paper); the box itself shows none. The list
 * scrolls when it does not fit.
 */
function SinglesBox({ category, box, id, activeId, onHover, onSelect }) {
  return (
    <div
      role="group"
      aria-label={`Other keywords in ${category}`}
      className={`${BOX_CLASS} flex flex-col`}
      style={{ ...placement(box.rect), padding: BOX_PADDING, lineHeight: LINE_HEIGHT }}
      onMouseEnter={() => onHover(null)}
    >
      <span className="block shrink-0 text-xs font-semibold">Other keywords</span>
      {/* The heading stays put and the list scrolls when it is longer than the box. */}
      <span className="block min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 text-xs text-white/90 [scrollbar-color:rgba(255,255,255,0.5)_transparent] [scrollbar-width:thin]">
        {box.keywords.map((keyword, index) => {
          const keywordId = singleKeywordId(id, keyword);
          const active = activeId === keywordId;
          // Keyword and its comma never break apart; the line can only wrap at the space after the comma.
          return (
            <span key={keyword}>
              <span className="whitespace-nowrap">
                <button
                  type="button"
                  aria-pressed={active}
                  className={`text-left hover:underline ${active ? "font-semibold text-white underline" : ""}`}
                  onMouseEnter={() => onHover(keywordId)}
                  onFocus={() => onHover(keywordId)}
                  onClick={() => onSelect(keywordId)}
                >
                  {keyword}
                </button>
                {index < box.keywords.length - 1 ? "," : ""}
              </span>{" "}
            </span>
          );
        })}
      </span>
    </div>
  );
}

/** One keyword box: bold name (wrapped as laid out) with its paper count below it or beside its last line. */
function KeywordBox({ category, box, id, activeId, onHover, onSelect }) {
  const active = activeId === id;
  return (
    <button
      type="button"
      aria-label={`${box.keywords[0]} in ${category}: ${papersLabel(box.size)}`}
      aria-pressed={active}
      onMouseEnter={() => onHover(id)}
      onFocus={() => onHover(id)}
      onClick={() => onSelect(id)}
      className={`${BOX_CLASS} transition hover:bg-white/25 ${active ? "ring-2 ring-white" : ""}`}
      style={{ ...placement(box.rect), padding: BOX_PADDING, lineHeight: LINE_HEIGHT }}
    >
      <span className="block font-semibold" style={{ fontSize: box.label.size }}>
        {box.label.lines.map((line, index) => (
          <span key={line} className="block whitespace-nowrap">
            {line}
            {box.label.inline && index === box.label.lines.length - 1 ? (
              <span className="font-normal text-white/85" style={{ fontSize: COUNT_FONT_SIZE, marginLeft: COUNT_GAP }}>
                {box.size}
              </span>
            ) : null}
          </span>
        ))}
      </span>
      {box.label.inline ? null : (
        <span className="block text-white/85" style={{ fontSize: COUNT_FONT_SIZE }}>
          {box.size}
        </span>
      )}
    </button>
  );
}

/** Card for the active keyword, beside the treemap (see cardPosition), listing its papers with links. */
function PaperCard({ selection, pinned, width, height, room }) {
  const { category, box, keyword } = selection;
  const papers = box.papers.filter((paper) => topicKeywords(paper).includes(keyword));
  return (
    <div
      role="dialog"
      aria-label={`${category}: ${keyword}`}
      className="absolute z-10 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 text-left shadow-lg"
      style={cardPosition(box.rect, width, height, room)}
    >
      <p className="!mt-0 text-sm font-semibold text-slate-900">
        {keyword}
        <span className="ml-2 font-normal text-slate-500">
          {category} · {papersLabel(papers.length)}
        </span>
      </p>
      <p className="!mt-0.5 text-xs text-slate-500">
        {pinned ? "Pinned. Click the topic again to close." : "Click the topic to keep this open."}
      </p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm marker:text-slate-400">
        {papers.map((paper) => (
          <li key={paper.ID} className="leading-snug">
            {paper["Paper Link"] ? (
              <a
                href={paper["Paper Link"]}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
              >
                {paper["Paper title"]}
              </a>
            ) : (
              <span className="text-slate-900">{paper["Paper title"]}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Home page section with the topics treemap; it stays in the text column and takes its room from height. */
export default function TopicsSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hoveredId, setHoveredId] = useState(null);
  const [pinnedId, setPinnedId] = useState(null);
  const containerRef = useRef(null);
  const closeTimer = useRef(null);
  const width = useElementWidth(containerRef);
  const sideRoom = useSideRoom(containerRef, width);

  useEffect(() => {
    fetch(asset("data.csv"))
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load data.csv (${response.status})`);
        return response.text();
      })
      .then((text) => setRows(parseTableCsv(text)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Leaving the treemap closes the hovered card only after a short delay, so the mouse can cross the gap
  // into the card (which is part of the treemap element, so entering it cancels the close).
  const cancelHoverClose = () => clearTimeout(closeTimer.current);
  const scheduleHoverClose = () => {
    cancelHoverClose();
    closeTimer.current = setTimeout(() => setHoveredId(null), HOVER_CLOSE_DELAY_MS);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const height = treemapHeight(width);
  const layout = useMemo(
    () => (width ? layoutTreemap(rows, width, height, createMeasure()) : []),
    [rows, width, height]
  );

  // Look up what a hover or pin id points to: a keyword box, or one keyword inside a used-once box
  // (the used-once box itself has no card). Keyed by id so the card follows the current layout.
  const selectionsById = useMemo(() => {
    const map = new Map();
    for (const cat of layout) {
      for (const box of cat.boxes) {
        const id = boxId(cat.category, box);
        if (box.kind === "singles") {
          for (const keyword of box.keywords) {
            map.set(singleKeywordId(id, keyword), { category: cat.category, box, keyword });
          }
        } else {
          map.set(id, { category: cat.category, box, keyword: box.keywords[0] });
        }
      }
    }
    return map;
  }, [layout]);
  // A pinned card wins over hovering, so its links can be reached across other boxes; click again to unpin.
  // A pin whose box no longer exists after a re-layout (for example once used-once keywords merge) is ignored.
  const livePinnedId = selectionsById.has(pinnedId) ? pinnedId : null;
  const activeId = livePinnedId ?? hoveredId;
  const selection = selectionsById.get(activeId) ?? null;

  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold text-slate-900">Topics</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Hover over or click a topic to see its papers.
      </p>
      {loading ? <p className="mt-3 text-sm text-slate-600">Loading papers…</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div
        ref={containerRef}
        className="relative mt-4 w-full"
        style={{ height: width ? height : undefined }}
        onMouseEnter={cancelHoverClose}
        onMouseLeave={scheduleHoverClose}
      >
        {layout.map((cat) => (
          <div
            key={cat.category}
            className="absolute overflow-hidden rounded-lg"
            style={{ ...placement(cat.rect), backgroundColor: TOPIC_CATEGORY_COLORS[cat.category] ?? FALLBACK_TOPIC_COLOR }}
          >
            {/* The name may be cut short with an ellipsis, but the count beside it never shrinks away. */}
            <div
              className="flex gap-1 font-semibold whitespace-nowrap text-white"
              style={{ fontSize: cat.header.size, lineHeight: `${HEADER_HEIGHT}px`, padding: `0 ${HEADER_PADDING}px` }}
              title={`${cat.category} (${papersLabel(cat.papers.length)})`}
            >
              <span className="min-w-0 truncate">{cat.header.name}</span>
              <span className="shrink-0 font-normal text-white/85">{cat.header.count}</span>
            </div>
          </div>
        ))}
        {layout.flatMap((cat) =>
          cat.boxes.map((box) => {
            const id = boxId(cat.category, box);
            const Box = box.kind === "singles" ? SinglesBox : KeywordBox;
            return (
              <Box
                key={id}
                category={cat.category}
                box={box}
                id={id}
                activeId={activeId}
                onHover={setHoveredId}
                onSelect={(target) => setPinnedId(target === pinnedId ? null : target)}
              />
            );
          })
        )}
        {selection ? (
          <PaperCard
            selection={selection}
            pinned={livePinnedId !== null}
            width={width}
            height={height}
            room={sideRoom}
          />
        ) : null}
      </div>
    </section>
  );
}
