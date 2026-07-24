import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BadgeCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useData } from "../data/DataContext";
import { axisBreaks } from "../data/chartData";
import { formatCount, formatMoney, securityDisplay } from "../utils/format";
import { bubbleRadius, clamp, extent, linearScale, percentile } from "../utils/scales";
import type { Security } from "../types";

const chart = { width: 850, height: 430, padX: 72, padY: 48 };

export function ConsensusMap() {
  const { securities, sampleNote, aggregates } = useData();
  const [selected, setSelected] = useState<Security | null>(null);
  const reduceMotion = useReducedMotion();

  const plotSecurities = useMemo(
    () =>
      securities
        .filter(
          (security) =>
            security.hasConsensus &&
            security.holderCount > 0 &&
            security.netFlow != null &&
            security.aggregateValue > 0,
        )
        .sort((a, b) => b.aggregateValue - a.aggregateValue)
        .slice(0, 40),
    [securities],
  );

  const layout = useMemo(() => {
    const holders = plotSecurities.map((item) => item.holderCount);
    const flows = plotSecurities.map((item) => item.netFlow ?? 0);
    const values = plotSecurities.map((item) => item.aggregateValue);
    const holderDomain = extent(holders, 0.05);
    const flowDomain = extent(flows, 0.08);
    const maxValue = Math.max(...values, 1);
    const holderMid = percentile(holders, 0.5);
    const flowZeroY = linearScale(0, flowDomain, [
      chart.height - chart.padY,
      chart.padY,
    ]);
    const holderMidX = linearScale(holderMid, holderDomain, [
      chart.padX,
      chart.width - chart.padX,
    ]);

    const points = plotSecurities.map((security) => {
      const x = clamp(
        linearScale(security.holderCount, holderDomain, [
          chart.padX,
          chart.width - chart.padX,
        ]),
        chart.padX + 8,
        chart.width - chart.padX - 8,
      );
      const y = clamp(
        linearScale(security.netFlow ?? 0, flowDomain, [
          chart.height - chart.padY,
          chart.padY,
        ]),
        chart.padY + 8,
        chart.height - chart.padY - 8,
      );
      const r = bubbleRadius(security.aggregateValue, maxValue, 7, 24);
      return { security, x, y, r, label: securityDisplay(security) };
    });

    // Light collision nudge for overlapping labels
    const nudged = points.map((point, index) => {
      let { x, y } = point;
      for (let i = 0; i < index; i += 1) {
        const other = points[i];
        const dx = x - other.x;
        const dy = y - other.y;
        const minDist = point.r + other.r + 4;
        const dist = Math.hypot(dx, dy) || 0.01;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          x += (dx / dist) * push;
          y += (dy / dist) * push;
        }
      }
      return {
        ...point,
        x: clamp(x, chart.padX + 8, chart.width - chart.padX - 8),
        y: clamp(y, chart.padY + 8, chart.height - chart.padY - 8),
      };
    });

    const holderBreaks = axisBreaks(holders);
    const flowBreaks = axisBreaks(flows);

    return {
      points: nudged,
      holderMidX,
      flowZeroY,
      holderBreaks,
      flowBreaks,
      holderMid,
    };
  }, [plotSecurities]);

  const tickerCoverage = aggregates?.coverage.tickerPct ?? 0;

  return (
    <section className="hero-panel map-panel" aria-labelledby="map-title">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Conviction plane</span>
          <h2 id="map-title">Consensus ↔ Contrarian</h2>
          <p>Crowding against this quarter&apos;s net reported value change. Scales adapt to the current sample.</p>
        </div>
        <div className="map-key">
          <span><i className="insider-ring" /> insider buy linked</span>
          <span>Bubble = aggregate value</span>
        </div>
      </header>

      {plotSecurities.length === 0 ? (
        <div className="empty-signal hero-empty">
          <strong>No consensus points to plot</strong>
          <p>
            Need resolved holder counts and net flow. Ticker coverage in this sample is{" "}
            {tickerCoverage.toFixed(0)}%.
          </p>
        </div>
      ) : (
        <div className="map-wrap">
          <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="Consensus and contrarian map">
            <rect
              x={chart.padX}
              y={chart.padY}
              width={layout.holderMidX - chart.padX}
              height={layout.flowZeroY - chart.padY}
              className="quadrant q-emerging"
            />
            <rect
              x={layout.holderMidX}
              y={chart.padY}
              width={chart.width - chart.padX - layout.holderMidX}
              height={layout.flowZeroY - chart.padY}
              className="quadrant q-crowded"
            />
            <rect
              x={chart.padX}
              y={layout.flowZeroY}
              width={layout.holderMidX - chart.padX}
              height={chart.height - chart.padY - layout.flowZeroY}
              className="quadrant q-lonely"
            />
            <rect
              x={layout.holderMidX}
              y={layout.flowZeroY}
              width={chart.width - chart.padX - layout.holderMidX}
              height={chart.height - chart.padY - layout.flowZeroY}
              className="quadrant q-exits"
            />
            <line className="axis-line" x1={layout.holderMidX} y1={chart.padY} x2={layout.holderMidX} y2={chart.height - chart.padY} />
            <line className="axis-line" x1={chart.padX} y1={layout.flowZeroY} x2={chart.width - chart.padX} y2={layout.flowZeroY} />
            <text className="quadrant-label" x={chart.padX + 12} y={chart.padY + 16}>EMERGING</text>
            <text className="quadrant-label" x={layout.holderMidX + 12} y={chart.padY + 16}>CROWDED + GAINING</text>
            <text className="quadrant-label" x={chart.padX + 12} y={chart.height - chart.padY - 12}>THIN / LOSING</text>
            <text className="quadrant-label" x={layout.holderMidX + 12} y={chart.height - chart.padY - 12}>CROWDED EXITS</text>
            <text className="axis-label" x={chart.width / 2} y={chart.height - 12} textAnchor="middle">
              HOLDER COUNT → median {formatCount(layout.holderMid)}
            </text>
            <text className="axis-label y-label" transform="translate(18 250) rotate(-90)">
              NET REPORTED VALUE CHANGE →
            </text>
            <text className="axis-tick" x={chart.padX} y={chart.height - 18}>{formatCount(layout.holderBreaks.min)}</text>
            <text className="axis-tick" x={chart.width - chart.padX} y={chart.height - 18} textAnchor="end">
              {formatCount(layout.holderBreaks.max)}
            </text>
            <text className="axis-tick" x={chart.padX - 8} y={chart.padY + 4} textAnchor="end">
              {formatMoney(layout.flowBreaks.max)}
            </text>
            <text className="axis-tick" x={chart.padX - 8} y={chart.height - chart.padY} textAnchor="end">
              {formatMoney(layout.flowBreaks.min)}
            </text>

            {layout.points.map((point, index) => {
              const positive = (point.security.netFlow ?? 0) >= 0;
              return (
                <motion.g
                  key={point.security.id}
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: reduceMotion ? 0 : index * 0.02, duration: 0.25 }}
                  onClick={() => setSelected(point.security)}
                  className="bubble-group"
                  role="button"
                  tabIndex={0}
                  aria-label={`${point.label}, ${point.security.holderCount} holders, ${formatMoney(point.security.netFlow ?? 0)} flow`}
                  onKeyDown={(event) => event.key === "Enter" && setSelected(point.security)}
                >
                  {point.security.insiderSignal && (
                    <circle cx={point.x} cy={point.y} r={point.r + 6} className="bubble-insider-ring" />
                  )}
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={point.r}
                    className={`bubble ${positive ? "positive" : "negative"} ${selected?.id === point.security.id ? "selected" : ""}`}
                  />
                  {(index < 12 || selected?.id === point.security.id) && (
                    <text x={point.x} y={point.y + 3} textAnchor="middle" className="bubble-label">
                      {point.label.slice(0, 8)}
                    </text>
                  )}
                </motion.g>
              );
            })}
          </svg>

          <AnimatePresence>
            {selected && (
              <motion.aside
                className="map-inspector"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
              >
                <button className="inspector-close" onClick={() => setSelected(null)} aria-label="Close security inspector">
                  <X size={14} />
                </button>
                <span className="ticker-chip">{securityDisplay(selected)}</span>
                <h3>{selected.issuer}</h3>
                <p>
                  {selected.sector === "Unclassified" ? "Sector unresolved" : selected.sector}
                  {" · "}
                  {selected.figi === "Unresolved" ? "FIGI unresolved" : selected.figi}
                </p>
                <dl>
                  <div><dt>Reported holders</dt><dd>{formatCount(selected.holderCount)}</dd></div>
                  <div>
                    <dt>Quarter value Δ</dt>
                    <dd className={(selected.netFlow ?? 0) >= 0 ? "up" : "down"}>
                      {selected.netFlow == null ? "n/a" : formatMoney(selected.netFlow)}
                    </dd>
                  </div>
                  <div><dt>Aggregate value</dt><dd>{formatMoney(selected.aggregateValue)}</dd></div>
                </dl>
                {selected.insiderSignal && (
                  <div className="signal-note">
                    <BadgeCheck size={15} /> Open-market insider buy overlaps
                  </div>
                )}
                <p className="inspector-note">{sampleNote}</p>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
