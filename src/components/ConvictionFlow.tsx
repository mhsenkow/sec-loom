import { motion } from "framer-motion";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useData } from "../data/DataContext";
import { formatMoney } from "../data/mockData";

const colors = [
  "var(--positive)",
  "var(--accent)",
  "var(--accent-2)",
  "var(--sun)",
  "var(--negative)",
];

export function ConvictionFlow() {
  const { holdingDiffs, managers, securities, periods } = useData();
  const [periodIndex, setPeriodIndex] = useState(0);
  const [playing, setPlaying] = useState(periods.length > 1);

  const streams = useMemo(() => {
    const maxDelta = Math.max(...holdingDiffs.map((diff) => Math.abs(diff.delta)), 1);
    return [...holdingDiffs]
      .filter((diff) => diff.delta !== 0)
      .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
      .slice(0, 5)
      .map((diff, index) => {
        const manager = managers.find((item) => item.cik === diff.managerCik);
        const security = securities.find((item) => item.id === diff.securityId);
        return {
          id: `${diff.managerCik}-${diff.securityId}`,
          manager: manager?.shortName ?? diff.managerCik,
          sector: security?.sector ?? "Unclassified",
          security: security?.ticker ?? "UNRES",
          width: 5 + (Math.abs(diff.delta) / maxDelta) * 12,
          color: diff.delta < 0 ? "var(--negative)" : colors[index % colors.length],
          delta: diff.delta,
        };
      });
  }, [holdingDiffs, managers, securities]);

  const sectorPositions = useMemo(
    () => positions([...new Set(streams.map((stream) => stream.sector))]),
    [streams],
  );
  const securityPositions = useMemo(
    () => positions([...new Set(streams.map((stream) => stream.security))]),
    [streams],
  );
  const managerPositions = positions(streams.map((stream) => stream.id));
  const grossFlow = streams.reduce((sum, stream) => sum + Math.max(stream.delta, 0), 0);
  const visiblePeriodIndex = Math.min(periodIndex, Math.max(periods.length - 1, 0));

  useEffect(() => {
    if (!playing || periods.length < 2) return;
    const timer = window.setInterval(
      () => setPeriodIndex((index) => (index + 1) % periods.length),
      2800,
    );
    return () => window.clearInterval(timer);
  }, [periods.length, playing]);

  return (
    <section className="hero-panel flow-panel" aria-labelledby="flow-title">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Capital choreography</span>
          <h2 id="flow-title">Conviction Flow</h2>
          <p>Trace the largest reported changes from manager to sector to security.</p>
        </div>
        <div className="live-badge">
          <span /> {periods.length > 1 ? "Playback" : "Latest complete"} · {periods[visiblePeriodIndex] ?? "Unavailable"}
        </div>
      </header>

      <div className="flow-stage">
        <div className="flow-labels">
          <span>Managers</span><span>Sectors</span><span>Securities</span>
        </div>
        <svg viewBox="0 0 900 360" role="img" aria-label="Animated manager to security capital flow">
          <defs>
            <filter id="streamGlow">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {[75, 168, 261].map((y) => <line key={y} className="flow-guide" x1="0" y1={y} x2="900" y2={y} />)}
          {streams.map((stream, index) => {
            const startY = managerPositions[stream.id] ?? 180;
            const middleY = sectorPositions[stream.sector] ?? 180;
            const endY = securityPositions[stream.security] ?? 180;
            const path = `M 120 ${startY} C 245 ${startY}, 250 ${middleY}, 400 ${middleY} C 560 ${middleY}, 600 ${endY}, 760 ${endY}`;
            return (
              <g key={stream.id}>
                <motion.path
                  d={path}
                  fill="none"
                  stroke={stream.color}
                  strokeOpacity="0.12"
                  strokeWidth={stream.width + 10}
                  animate={{ strokeOpacity: [0.08, 0.16, 0.08] }}
                  transition={{ duration: 3.4, repeat: Infinity, delay: index * 0.3 }}
                />
                <motion.path
                  d={path}
                  fill="none"
                  stroke={stream.color}
                  strokeWidth={stream.width}
                  strokeLinecap="round"
                  pathLength="1"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.1, delay: index * 0.12, ease: [0.2, 0, 0, 1] }}
                />
                <motion.circle r="4" fill="var(--surface-strong)" stroke={stream.color} strokeWidth="2" filter="url(#streamGlow)">
                  <animateMotion dur={`${2.8 + index * 0.22}s`} repeatCount="indefinite" path={path} />
                </motion.circle>
                <text x="16" y={startY + 4} className="flow-node-label">{stream.manager}</text>
              </g>
            );
          })}
          {Object.entries(sectorPositions).map(([sector, y]) => (
            <g key={sector}>
              <rect x="366" y={y - 17} width="98" height="34" rx="2" className="flow-node" />
              <text x="415" y={y + 4} textAnchor="middle" className="flow-node-label">{sector.slice(0, 14)}</text>
            </g>
          ))}
          {Object.entries(securityPositions).map(([ticker, y]) => (
            <g key={ticker}>
              <rect x="756" y={y - 20} width="76" height="40" rx="2" className="flow-security" />
              <text x="794" y={y + 5} textAnchor="middle" className="flow-security-label">{ticker.slice(0, 8)}</text>
            </g>
          ))}
        </svg>
        <div className="flow-total">
          <span>Flow in focus</span>
          <strong>+{formatMoney(grossFlow)}</strong>
          <small>largest reported additions</small>
        </div>
      </div>

      <div className="timeline-control">
        <button
          className="icon-button"
          onClick={() => periods.length > 1 && setPlaying((value) => !value)}
          aria-label={playing ? "Pause" : "Play"}
          disabled={periods.length < 2}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <div className="timeline-track" style={{ gridTemplateColumns: `repeat(${Math.max(periods.length, 1)}, 1fr)` }}>
          {periods.map((period, index) => (
            <button
              key={period}
              onClick={() => { setPeriodIndex(index); setPlaying(false); }}
              className={index === visiblePeriodIndex ? "active" : ""}
            >
              <span />
              {period}
            </button>
          ))}
        </div>
        <button className="icon-button" onClick={() => setPeriodIndex(0)} aria-label="Reset timeline"><RotateCcw size={14} /></button>
      </div>
      <p className="sr-only">{securities.length} securities represented in the current flow.</p>
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
