import { NavLink } from "react-router-dom";

const linkClass = ({ isActive }) =>
  `text-sm font-medium transition ${
    isActive ? "text-slate-900" : "text-slate-500 hover:text-slate-800"
  }`;

export default function NavBar() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-3 sm:px-8">
        <NavLink to="/" className="text-sm font-semibold tracking-tight text-slate-900">
          What LLMs Can(not) Do
        </NavLink>
        <nav className="flex items-center gap-5">
          <NavLink to="/" end className={linkClass}>
            Home
          </NavLink>
          <NavLink to="/table" className={linkClass}>
            Table
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
