import { motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";
import { useData } from "../data/DataContext";
import { hasSectorCoverage, summarizeNet, topMoves } from "../data/chartData";
import { formatMoney } from "../utils/format";
import { robustWidth } from "../utils/scales";

export function ConvictionFlow() {
  const { holdingDiffs, managers, securities, periods, sampleNote } = useData();
  const reduceMotion = useReducedMotion();
  const useSectors = hasSectorCoverage(securities);

  const streams = useMemo(() => {
    const moves = topMoves(holdingDiffs, managers, securities, 6);
    const maxDelta = Math.max(...moves.map((item) => Math.abs(item.delta)), 1);
    return moves.map((diff) => ({
      id: `${diff.managerCik}-${diff.securityId}`,
      manager: diff.managerLabel,
      middle: useSectors
        ? (diff.security?.sector ?? "Unclassified")
        : diff.action,
      security: diff.label,
      width: robustWidth(diff.delta, maxDelta, 3.5, 14),
      color: diff.delta < 0 ? "var(--negative)" : "var(--positive)",
      delta: diff.delta,
      action: diff.action,
    }));
  }, [holdingDiffs, managers, securities, useSectors]);

  const middlePositions = useMemo(
    () => positions([...new Set(streams.map((stream) => stream.middle))]),
    [streams],
  );
  const securityPositions = useMemo(
    () => positions([...new Set(streams.map((stream) => stream.security))]),
    [streams],
  );
  const managerPositions = positions(streams.map((stream) => stream.id));
  const totals = summarizeNet(streams.map((stream) => stream.delta));

  return (
    <section className="hero-panel flow-panel" aria-labelledby="flow-title">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Capital choreography</span>
          <h2 id="flow-title">Conviction Flow</h2>
          <p>
            Largest reported value changes from manager to{" "}
            {useSectors ? "sector" : "action"} to security. Share actions and dollar deltas can disagree.
          </p>
        </div>
        <div className="live-badge muted">
          <span /> Latest complete · {periods[0] ?? "Unavailable"}
        </div>
      </header>

      {streams.length === 0 ? (
        <div className="empty-signal hero-empty">
          <strong>No material reported moves</strong>
          <p>Flow needs non-zero top moves from the current dashboard sample.</p>
        </div>
      ) : (
        <div className="flow-stage">
          <div className="flow-labels">
            <span>Managers</span>
            <span>{useSectors ? "Sectors" : "Actions"}</span>
            <span>Securities</span>
          </div>
          <svg viewBox="0 0 900 360" role="img" aria-label="Manager to security reported-value flow">
            <defs>
              <filter id="streamGlow">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {[75, 168, 261].map((y) => (
              <line key={y} className="flow-guide" x1="0" y1={y} x2="900" y2={y} />
            ))}
            {streams.map((stream, index) => {
              const startY = managerPositions[stream.id] ?? 180;
              const middleY = middlePositions[stream.middle] ?? 180;
              const endY = securityPositions[stream.security] ?? 180;
              const path = `M 120 ${startY} C 245 ${startY}, 250 ${middleY}, 400 ${middleY} C 560 ${middleY}, 600 ${endY}, 760 ${endY}`;
              return (
                <g key={stream.id}>
                  <title>
                    {stream.manager} · {stream.action} · {stream.security}: {formatMoney(stream.delta, true)}
                  </title>
                  <motion.path
                    d={path}
                    fill="none"
                    stroke={stream.color}
                    strokeOpacity="0.14"
                    strokeWidth={stream.width + 8}
                    animate={reduceMotion ? undefined : { strokeOpacity: [0.08, 0.18, 0.08] }}
                    transition={{ duration: 3.4, repeat: Infinity, delay: index * 0.25 }}
                  />
                  <motion.path
                    d={path}
                    fill="none"
                    stroke={stream.color}
                    strokeWidth={stream.width}
                    strokeLinecap="round"
                    pathLength="1"
                    initial={reduceMotion ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: reduceMotion ? 0 : 0.9, delay: reduceMotion ? 0 : index * 0.08 }}
                  />
                  {!reduceMotion && (
                    <motion.circle
                      r="3.5"
                      fill="var(--surface-strong)"
                      stroke={stream.color}
                      strokeWidth="2"
                      filter="url(#streamGlow)"
                    >
                      <animateMotion dur={`${3 + index * 0.2}s`} repeatCount="indefinite" path={path} />
                    </motion.circle>
                  )}
                  <text x="16" y={startY + 4} className="flow-node-label">
                    {stream.manager.slice(0, 16)}
                  </text>
                  <text x="770" y={endY - 14} className="flow-delta-label" fill={stream.color}>
                    {formatMoney(stream.delta, true)}
                  </text>
                </g>
              );
            })}
            {Object.entries(middlePositions).map(([label, y]) => (
              <g key={label}>
                <rect x="366" y={y - 17} width="98" height="34" rx="2" className="flow-node" />
                <text x="415" y={y + 4} textAnchor="middle" className="flow-node-label">
                  {label.slice(0, 14)}
                </text>
              </g>
            ))}
            {Object.entries(securityPositions).map(([ticker, y]) => (
              <g key={ticker}>
                <rect x="756" y={y - 20} width="88" height="40" rx="2" className="flow-security" />
                <text x="800" y={y + 5} textAnchor="middle" className="flow-security-label">
                  {ticker.slice(0, 10)}
                </text>
              </g>
            ))}
          </svg>
          <div className="flow-total">
            <span>Top-move reported value</span>
            <strong className={totals.inflow >= Math.abs(totals.outflow) ? "up" : "down"}>
              {formatMoney(totals.net, true)}
            </strong>
            <small>
              +{totals.inflowLabel} / {totals.outflowLabel}
            </small>
          </div>
        </div>
      )}

      <div className="timeline-control static-period">
        <div className="timeline-track" style={{ gridTemplateColumns: "1fr" }}>
          <button type="button" className="active" disabled>
            <span />
            {periods[0] ?? "Unavailable"}
          </button>
        </div>
        <p className="timeline-note">{sampleNote}</p>
      </div>
      <p className="sr-only">
        Showing {streams.length} largest reported moves
        {streams[0] ? `, led by ${streams[0].security}` : ""}.
      </p>
    </section>
  );
}

function positions(values: string[]) {
  const unique = [...new Set(values)];
  return Object.fromEntries(
    unique.map((value, index) => [
      value,
      unique.length === 1 ? 180 : 70 + (index * 230) / (unique.length - 1),
    ]),
  ) as Record<string, number>;
}
