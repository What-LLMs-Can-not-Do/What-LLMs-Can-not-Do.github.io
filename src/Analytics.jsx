import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { GOATCOUNTER_CODE } from "./config.js";

const SCRIPT_ID = "goatcounter-script";

function pagePath(pathname, search) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "") || "";
  return `${base}${pathname}${search || ""}` || "/";
}

function ensureGoatCounterScript() {
  if (!GOATCOUNTER_CODE || document.getElementById(SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = "https://gc.zgo.at/count.js";
  script.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
  // SPA: we count on route changes ourselves.
  script.dataset.goatcounterSettings = JSON.stringify({ no_onload: true });
  script.onload = () => {
    const path = pagePath(window.location.pathname, window.location.search);
    window.goatcounter?.count?.({ path });
  };
  document.body.appendChild(script);
}

/** Privacy-friendly pageviews + rough country geo via GoatCounter (static-site compatible). */
export default function Analytics() {
  const location = useLocation();

  useEffect(() => {
    ensureGoatCounterScript();
  }, []);

  useEffect(() => {
    if (!GOATCOUNTER_CODE) return;
    const path = pagePath(location.pathname, location.search);
    window.goatcounter?.count?.({ path });
  }, [location.pathname, location.search]);

  return null;
}
