import { motion, useReducedMotion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, FileSearch, Rows3, TableProperties } from "lucide-react";
import { useMemo, useState } from "react";
import { useData } from "../data/DataContext";
import { formatMoney, formatPercent, securityDisplay } from "../utils/format";
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
  const { holdingDiffs, managers, securities, sampleNote, coveragePct } = useData();
  const [metric, setMetric] = useState<"diff" | "value">("diff");
  const [transpose, setTranspose] = useState(false);
  const [activeAction, setActiveAction] = useState<Action | "ALL">("ALL");
  const reduceMotion = useReducedMotion();

  const visibleDiffs = useMemo(
    () => holdingDiffs.filter((diff) => activeAction === "ALL" || diff.action === activeAction),
    [activeAction, holdingDiffs],
  );

  const activeManagerIds = useMemo(() => {
    const scores = new Map<string, number>();
    for (const diff of visibleDiffs) {
      scores.set(diff.managerCik, (scores.get(diff.managerCik) ?? 0) + Math.abs(diff.delta));
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cik]) => cik);
  }, [visibleDiffs]);

  const activeSecurityIds = useMemo(() => {
    const scores = new Map<string, number>();
    for (const diff of visibleDiffs) {
      scores.set(diff.securityId, (scores.get(diff.securityId) ?? 0) + Math.abs(diff.delta));
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  }, [visibleDiffs]);

  const rowManagers = useMemo(
    () => activeManagerIds
      .map((cik) => managers.find((manager) => manager.cik === cik))
      .filter((manager): manager is NonNullable<typeof manager> => Boolean(manager)),
    [activeManagerIds, managers],
  );
  const columnSecurities = useMemo(
    () => activeSecurityIds
      .map((id) => securities.find((security) => security.id === id))
      .filter((security): security is NonNullable<typeof security> => Boolean(security)),
    [activeSecurityIds, securities],
  );

  const rows = transpose ? columnSecurities : rowManagers;
  const columns = transpose ? rowManagers : columnSecurities;
  const hiddenCount = holdingDiffs.length - visibleDiffs.length;

  return (
    <section className="hero-panel whale-panel" aria-labelledby="whale-title">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Primary surface / Diff first</span>
          <h2 id="whale-title">The Whale Grid</h2>
          <p>Largest reported moves only — not a full holdings book. Click a cell to cite the filing.</p>
        </div>
        <div className="panel-tools">
          <div className="segmented" aria-label="Cell metric" role="group">
            <button
              type="button"
              aria-pressed={metric === "diff"}
              className={metric === "diff" ? "active" : ""}
              onClick={() => setMetric("diff")}
            >
              ∆ Value
            </button>
            <button
              type="button"
              aria-pressed={metric === "value"}
              className={metric === "value" ? "active" : ""}
              onClick={() => setMetric("value")}
            >
              Position
            </button>
          </div>
          <button
            className="icon-button"
            onClick={() => setTranspose((value) => !value)}
            aria-label="Transpose grid"
            title="Transpose grid"
          >
            {transpose ? <Rows3 size={16} /> : <TableProperties size={16} />}
          </button>
        </div>
      </header>

      <div className="action-filter" aria-label="Filter by action">
        {(["ALL", "NEW", "ADD", "TRIM", "EXIT", "HOLD"] as const).map((action) => (
          <button
            key={action}
            type="button"
            aria-pressed={activeAction === action}
            className={activeAction === action ? "active" : ""}
            onClick={() => setActiveAction(action)}
          >
            <span className={`filter-dot ${action.toLowerCase()}`} />
            {action === "ALL" ? "All moves" : actionLabel[action]}
          </button>
        ))}
      </div>

      <div className="chart-meta-bar">
        <span>{visibleDiffs.length} moves shown</span>
        {hiddenCount > 0 && <span>{hiddenCount} filtered out</span>}
        <span>{rowManagers.length} managers · {columnSecurities.length} securities</span>
        {coveragePct != null && <span>Dataset resolution {formatPercent(coveragePct, 1)}</span>}
      </div>

      {visibleDiffs.length === 0 ? (
        <div className="empty-signal hero-empty">
          <strong>No reported moves for this filter</strong>
          <p>Try “All moves”, or wait for the next complete 13F period.</p>
        </div>
      ) : (
        <div className="grid-scroll">
          <div
            className="whale-grid"
            style={{
              gridTemplateColumns: `minmax(132px, 1.2fr) repeat(${columns.length}, minmax(88px, 1fr))`,
            }}
          >
            <div className="grid-corner">
              <span>{transpose ? "Security" : "Manager"}</span>
              <small>{transpose ? "Manager →" : "Security →"}</small>
            </div>
            {columns.map((column) => {
              const isManager = "cik" in column;
              return (
                <div className="column-head" key={isManager ? column.cik : column.id}>
                  <strong>
                    {isManager ? column.shortName : securityDisplay(column)}
                  </strong>
                  <span>
                    {isManager
                      ? formatMoney(column.aum)
                      : column.ticker
                        ? column.issuer
                        : "Unresolved ticker"}
                  </span>
                </div>
              );
            })}

            {rows.map((row, rowIndex) => {
              const rowIsManager = "cik" in row;
              return [
                <div className="row-head" key={`head-${rowIsManager ? row.cik : row.id}`}>
                  <strong>{rowIsManager ? row.shortName : securityDisplay(row)}</strong>
                  <span>
                    {rowIsManager
                      ? `${row.moveCount ?? 0} moves`
                      : row.sector === "Unclassified"
                        ? "Sector unresolved"
                        : row.sector}
                  </span>
                </div>,
                ...columns.map((column, columnIndex) => {
                  const managerCik = rowIsManager ? row.cik : "cik" in column ? column.cik : "";
                  const securityId = rowIsManager ? ("id" in column ? column.id : "") : row.id;
                  const diff = visibleDiffs.find(
                    (item) => item.managerCik === managerCik && item.securityId === securityId,
                  );
                  if (!diff) {
                    return (
                      <div
                        className="grid-cell muted"
                        key={`${rowIndex}-${columnIndex}`}
                        title="No move in the current top-move sample"
                      >
                        ·
                      </div>
                    );
                  }
                  const displayValue = metric === "diff" ? diff.delta : diff.value;
                  const up = displayValue > 0;
                  const down = displayValue < 0;
                  return (
                    <motion.button
                      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: reduceMotion ? 0 : Math.min((rowIndex + columnIndex) * 0.01, 0.2),
                      }}
                      className={`grid-cell action-${diff.action.toLowerCase()} ${up ? "value-up" : ""} ${down ? "value-down" : ""}`}
                      key={`${managerCik}-${securityId}`}
                      onClick={() => onCite(diff)}
                      aria-label={`${actionLabel[diff.action]}, reported value ${formatMoney(displayValue, true)}. Open citation.`}
                    >
                      <span className="cell-action">
                        {up ? <ArrowUpRight size={12} /> : down ? <ArrowDownRight size={12} /> : null}
                        {diff.action}
                      </span>
                      <strong>{formatMoney(displayValue, true)}</strong>
                      {metric === "diff" && Math.sign(diff.delta) !== shareSign(diff.action) && (
                        <small className="cell-note">shares ≠ value</small>
                      )}
                      <FileSearch className="cite-glyph" size={12} />
                    </motion.button>
                  );
                }),
              ];
            })}
          </div>
        </div>
      )}

      <footer className="panel-foot">
        <span><i className="legend new" /> New / add (shares)</span>
        <span><i className="legend trim" /> Trim / exit (shares)</span>
        <span><i className="legend hold" /> No share change</span>
        <span className="foot-note">{sampleNote}</span>
      </footer>
    </section>
  );
}

function shareSign(action: Action) {
  if (action === "NEW" || action === "ADD") return 1;
  if (action === "TRIM" || action === "EXIT") return -1;
  return 0;
}
