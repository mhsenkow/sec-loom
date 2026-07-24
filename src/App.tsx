import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Bell,
  ChevronDown,
  CircleHelp,
  Clock3,
  DatabaseZap,
  Download,
  FileWarning,
  Grid3X3,
  Menu,
  Orbit,
  Search,
  ShieldCheck,
  SunMoon,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";
import { ConsensusMap } from "./components/ConsensusMap";
import { ConvictionFlow } from "./components/ConvictionFlow";
import { InsightDeck } from "./components/InsightDeck";
import { ProvenanceDialog } from "./components/ProvenanceDialog";
import { SupportingPanels } from "./components/SupportingPanels";
import { WhaleGrid } from "./components/WhaleGrid";
import { useData } from "./data/DataContext";
import { themes, useTheme } from "./theme";
import type { HoldingDiff, View } from "./types";

const navItems: Array<{ id: View; label: string; icon: typeof Grid3X3 }> = [
  { id: "grid", label: "Whale Grid", icon: Grid3X3 },
  { id: "flow", label: "Conviction Flow", icon: Activity },
  { id: "map", label: "Consensus Map", icon: Orbit },
];

export default function App() {
  const [view, setView] = useState<View>("grid");
  const [citation, setCitation] = useState<HoldingDiff | null>(null);
  const [themeMenu, setThemeMenu] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const { theme, setTheme, mode } = useTheme();
  const { isLive, dataLabel, periods, lastRefreshed } = useData();
  const closeCitation = useCallback(() => setCitation(null), []);

  const changeView = (nextView: View) => {
    setView(nextView);
    setMobileNav(false);
    window.requestAnimationFrame(() => document.getElementById("workspace")?.focus());
  };

  return (
    <div className="app-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />

      <header className="topbar">
        <button className="mobile-menu icon-button" onClick={() => setMobileNav((value) => !value)} aria-label="Toggle navigation">
          {mobileNav ? <X size={18} /> : <Menu size={18} />}
        </button>
        <a className="brand" href="#" aria-label="SEC Loom home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><strong>SEC</strong> LOOM</span>
          <small>RESEARCH TERMINAL</small>
        </a>
        <div className="global-search">
          <Search size={15} />
          <input aria-label="Search managers, securities, or filings" placeholder="Search manager, ticker, FIGI, accession…" />
          <kbd>⌘ K</kbd>
        </div>
        <div className="top-actions">
          <div className="as-of">
            <Clock3 size={14} />
            <span>{dataLabel}</span>
            <strong>{isLive && lastRefreshed ? `Synced ${formatDate(lastRefreshed)}` : "Synthetic values"}</strong>
          </div>
          <button className="icon-button" aria-label="Notifications"><Bell size={16} /><i className="notification-dot" /></button>
          <div className="theme-picker">
            <button className="theme-trigger" onClick={() => setThemeMenu((value) => !value)}>
              <SunMoon size={15} />
              <span>{themes.find((item) => item.id === theme)?.name}</span>
              <ChevronDown size={13} />
            </button>
            <AnimatePresence>
              {themeMenu && (
                <motion.div className="theme-menu" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
                  <span>Palette / {mode} mode</span>
                  {themes.map((item) => (
                    <button
                      key={item.id}
                      className={theme === item.id ? "active" : ""}
                      onClick={() => { setTheme(item.id); setThemeMenu(false); }}
                    >
                      <i style={{ background: item.swatch }} />
                      <span>{item.name}<small>{item.mode}</small></span>
                      {theme === item.id && "✓"}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <nav aria-label="Primary navigation">
          <span className="nav-label">Analyze</span>
          {navItems.map((item) => (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => changeView(item.id)}>
              <item.icon size={17} />
              <span>{item.label}</span>
              {item.id === "grid" && <em>LIVE</em>}
            </button>
          ))}
          <span className="nav-label">Research</span>
          <button><UsersRound size={17} /><span>Managers</span></button>
          <button><DatabaseZap size={17} /><span>Securities</span></button>
          <button><ShieldCheck size={17} /><span>Insider Wire</span></button>
        </nav>
        <div className="sidebar-foot">
          <div className="coverage-card">
            <div><span>Resolution coverage</span><strong>98.6%</strong></div>
            <div className="coverage-track"><i style={{ width: "98.6%" }} /></div>
            <small>By reported value · FIGI-first</small>
          </div>
          <button><CircleHelp size={16} /> Methodology & scope</button>
        </div>
      </aside>

      <main className="main-content" id="workspace" tabIndex={-1}>
        <div className="lag-banner">
          <FileWarning size={15} />
          <p>
            <strong>
              {isLive
                ? dataLabel === "Synced SEC snapshot"
                  ? "Synced SEC snapshot:"
                  : "Live SEC pipeline:"
                : "Demonstration data:"}
            </strong>{" "}
            {isLive
              ? dataLabel === "Synced SEC snapshot"
                ? "published from the latest local ingestion into GitHub Pages; attach Neon + Hyperdrive for continuous refresh."
                : "latest complete 13F positions plus current Forms 3/4/5; 13F holdings remain delayed up to 45 days."
              : "visual values are synthetic and must not be treated as current filings. Connect Postgres + Hyperdrive to replace them."}
          </p>
          <button>Understand the dataset</button>
        </div>

        <div className="workspace-head">
          <div>
            <span className="breadcrumb">INTELLIGENCE / <strong>{navItems.find((item) => item.id === view)?.label.toUpperCase()}</strong></span>
            <h1>{view === "grid" ? "See the move. Follow the filing." : view === "flow" ? "Capital leaves a trail." : "Map the crowded trade."}</h1>
            <p>{view === "grid" ? "Quarter-over-quarter institutional changes, resolved to freely licensed identifiers and backed by source filings." : view === "flow" ? "A narrated view of reported capital rotation across managers, sectors, and securities." : "Separate broad institutional conviction from concentrated or contrarian positioning."}</p>
          </div>
          <div className="workspace-actions">
            <button className="secondary-button"><Download size={15} /> Export <ChevronDown size={12} /></button>
            <button className="period-button"><span>Reporting period</span><strong>{periods[0] ?? "Unavailable"}</strong><ChevronDown size={14} /></button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={view} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.32, ease: [0.2, 0, 0, 1] }}>
            {view === "grid" && <WhaleGrid onCite={setCitation} />}
            {view === "flow" && <ConvictionFlow />}
            {view === "map" && <ConsensusMap />}
          </motion.div>
        </AnimatePresence>

        <InsightDeck onCite={setCitation} />
        <SupportingPanels />
        <footer className="site-footer">
          <span><strong>SEC LOOM</strong> · Research instrument, not investment advice.</span>
          <span>Every claim should have a thread back to EDGAR.</span>
        </footer>
      </main>

      <ProvenanceDialog diff={citation} onClose={closeCitation} />
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
