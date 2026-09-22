import { useLayoutEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

const logoSrc = `${import.meta.env.BASE_URL}logo_cropped.png`;
const FULL_TITLE = "What LLMs Can(not) Do";
const SHORT_TITLE = "WLCD";

const linkClass = ({ isActive }) =>
  `text-sm font-medium transition sm:text-base ${
    isActive ? "text-slate-900" : "text-slate-500 hover:text-slate-800"
  }`;

function BrandTitle() {
  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const [short, setShort] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const update = () => {
      setShort(measure.scrollWidth > container.clientWidth + 1);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden">
      <span
        ref={measureRef}
        className="pointer-events-none absolute left-0 top-0 whitespace-nowrap opacity-0"
        aria-hidden="true"
      >
        {FULL_TITLE}
      </span>
      <span className="block truncate">{short ? SHORT_TITLE : FULL_TITLE}</span>
    </span>
  );
}

export default function NavBar() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-6 sm:px-8 sm:py-4">
        <NavLink
          to="/"
          className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold tracking-tight text-slate-900 sm:gap-3 sm:text-lg"
        >
          <img
            src={logoSrc}
            alt=""
            className="h-8 w-auto shrink-0 object-contain sm:h-12"
          />
          <BrandTitle />
        </NavLink>
        <nav className="flex shrink-0 items-center gap-3 sm:gap-6">
          <NavLink to="/" end className={linkClass}>
            Home
          </NavLink>
          <NavLink to="/table" className={linkClass}>
            Table
          </NavLink>
          <NavLink to="/contribute" className={linkClass}>
            Contribute
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
