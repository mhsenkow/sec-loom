import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, FileSearch, Rows3, TableProperties } from "lucide-react";
import { useMemo, useState } from "react";
import { useData } from "../data/DataContext";
import { formatMoney } from "../data/mockData";
import type { Action, HoldingDiff } from "../types";

interface WhaleGridProps {
  onCite: (diff: HoldingDiff) => void;
}

const actionLabel: Record<Action, string> = {
  NEW: "New",
  ADD: "Added",
  TRIM: "Trimmed",
  EXIT: "Exited",
  HOLD: "Held",
};

export function WhaleGrid({ onCite }: WhaleGridProps) {
  const { holdingDiffs, managers, securities } = useData();
  const [metric, setMetric] = useState<"diff" | "value">("diff");
  const [transpose, setTranspose] = useState(false);
  const [activeAction, setActiveAction] = useState<Action | "ALL">("ALL");

  const visibleDiffs = useMemo(
    () => holdingDiffs.filter((diff) => activeAction === "ALL" || diff.action === activeAction),
    [activeAction, holdingDiffs],
  );

  const rows = transpose ? securities : managers;
  const columns = transpose ? managers : securities;

  return (
    <section className="hero-panel whale-panel" aria-labelledby="whale-title">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Primary surface / Diff first</span>
          <h2 id="whale-title">The Whale Grid</h2>
          <p>Who moved where — and the filing that proves it.</p>
        </div>
        <div className="panel-tools">
          <div className="segmented" aria-label="Cell metric">
            <button className={metric === "diff" ? "active" : ""} onClick={() => setMetric("diff")}>∆ Change</button>
            <button className={metric === "value" ? "active" : ""} onClick={() => setMetric("value")}>Position</button>
          </div>
          <button className="icon-button" onClick={() => setTranspose((value) => !value)} title="Transpose grid">
            {transpose ? <Rows3 size={16} /> : <TableProperties size={16} />}
          </button>
        </div>
      </header>

      <div className="action-filter" aria-label="Filter by action">
        {(["ALL", "NEW", "ADD", "TRIM", "EXIT"] as const).map((action) => (
          <button
            key={action}
            className={activeAction === action ? "active" : ""}
            onClick={() => setActiveAction(action)}
          >
            <span className={`filter-dot ${action.toLowerCase()}`} />
            {action === "ALL" ? "All moves" : actionLabel[action]}
          </button>
        ))}
      </div>

      <div className="grid-scroll">
        <div
          className="whale-grid"
          style={{ gridTemplateColumns: `minmax(158px, 1.35fr) repeat(${columns.length}, minmax(94px, 1fr))` }}
        >
          <div className="grid-corner">
            <span>{transpose ? "Security" : "Manager"}</span>
            <small>{transpose ? "Manager →" : "Security →"}</small>
          </div>
          {columns.map((column) => {
            const isManager = "cik" in column;
            return (
              <div className="column-head" key={isManager ? column.cik : column.id}>
                <strong>{isManager ? column.shortName : column.ticker}</strong>
                <span>{isManager ? formatMoney(column.aum) : column.sector}</span>
              </div>
            );
          })}

          {rows.map((row, rowIndex) => {
            const rowIsManager = "cik" in row;
            return [
              <div className="row-head" key={`head-${rowIsManager ? row.cik : row.id}`}>
                <strong>{rowIsManager ? row.shortName : row.ticker}</strong>
                <span>{rowIsManager ? `${row.coverage}% resolved` : row.issuer}</span>
              </div>,
              ...columns.map((column, columnIndex) => {
                const managerCik = rowIsManager ? row.cik : "cik" in column ? column.cik : "";
                const securityId = rowIsManager ? ("id" in column ? column.id : "") : row.id;
                const diff = visibleDiffs.find(
                  (item) => item.managerCik === managerCik && item.securityId === securityId,
                );
                if (!diff) return <div className="grid-cell empty" key={`${rowIndex}-${columnIndex}`}>·</div>;
                const displayValue = metric === "diff" ? diff.delta : diff.value;
                return (
                  <motion.button
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min((rowIndex * columns.length + columnIndex) * 0.012, 0.32) }}
                    className={`grid-cell action-${diff.action.toLowerCase()}`}
                    key={`${managerCik}-${securityId}`}
                    onClick={() => onCite(diff)}
                    aria-label={`${actionLabel[diff.action]}, ${formatMoney(displayValue, true)}. Open citation.`}
                  >
                    <span className="cell-action">
                      {diff.action === "ADD" || diff.action === "NEW" ? <ArrowUpRight size={12} /> :
                        diff.action === "TRIM" || diff.action === "EXIT" ? <ArrowDownRight size={12} /> : null}
                      {diff.action}
                    </span>
                    <strong>{formatMoney(displayValue, true)}</strong>
                    <FileSearch className="cite-glyph" size={12} />
                  </motion.button>
                );
              }),
            ];
          })}
        </div>
      </div>

      <footer className="panel-foot">
        <span><i className="legend new" /> New / add</span>
        <span><i className="legend trim" /> Trim / exit</span>
        <span><i className="legend hold" /> No material change</span>
        <span className="foot-note">Values in USD · click any cell to cite</span>
      </footer>
    </section>
  );
}
