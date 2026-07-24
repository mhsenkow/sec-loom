import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, X } from "lucide-react";
import { useState } from "react";
import { useData } from "../data/DataContext";
import { formatMoney } from "../data/mockData";
import type { Security } from "../types";

const chart = { width: 850, height: 430, padX: 80, padY: 54 };

function pointFor(security: Security) {
  const x = chart.padX + ((security.holderCount - 4) / 16) * (chart.width - chart.padX * 2);
  const y = chart.height - chart.padY - ((security.netFlow + 4_000) / 11_000) * (chart.height - chart.padY * 2);
  const r = 14 + Math.sqrt(security.aggregateValue) / 13;
  return { x, y, r };
}

export function ConsensusMap() {
  const { securities } = useData();
  const [selected, setSelected] = useState<Security | null>(null);

  return (
    <section className="hero-panel map-panel" aria-labelledby="map-title">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Conviction plane</span>
          <h2 id="map-title">Consensus ↔ Contrarian</h2>
          <p>Crowding against this quarter's net reported flow.</p>
        </div>
        <div className="map-key">
          <span><i className="insider-ring" /> insider buy filed</span>
          <span>Bubble = aggregate value</span>
        </div>
      </header>

      <div className="map-wrap">
        <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="Consensus and contrarian map">
          <rect x={chart.padX} y={chart.padY} width={(chart.width - chart.padX * 2) / 2} height={(chart.height - chart.padY * 2) / 2} className="quadrant q-emerging" />
          <rect x={chart.width / 2} y={chart.padY} width={(chart.width - chart.padX * 2) / 2} height={(chart.height - chart.padY * 2) / 2} className="quadrant q-crowded" />
          <rect x={chart.padX} y={chart.height / 2} width={(chart.width - chart.padX * 2) / 2} height={(chart.height - chart.padY * 2) / 2} className="quadrant q-lonely" />
          <rect x={chart.width / 2} y={chart.height / 2} width={(chart.width - chart.padX * 2) / 2} height={(chart.height - chart.padY * 2) / 2} className="quadrant q-exits" />
          <line className="axis-line" x1={chart.width / 2} y1={chart.padY} x2={chart.width / 2} y2={chart.height - chart.padY} />
          <line className="axis-line" x1={chart.padX} y1={chart.height / 2} x2={chart.width - chart.padX} y2={chart.height / 2} />
          <text className="quadrant-label" x="100" y="78">EMERGING CONSENSUS</text>
          <text className="quadrant-label" x="566" y="78">CROWDED CONSENSUS</text>
          <text className="quadrant-label" x="100" y="358">LONELY CONTRARIAN</text>
          <text className="quadrant-label" x="600" y="358">CROWDED EXITS</text>
          <text className="axis-label" x="400" y="416">HOLDER COUNT →</text>
          <text className="axis-label y-label" transform="translate(20 292) rotate(-90)">NET REPORTED FLOW →</text>

          {securities.map((security, index) => {
            const { x, y, r } = pointFor(security);
            const positive = security.netFlow >= 0;
            return (
              <motion.g
                key={security.id}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.055, duration: 0.35, ease: [0.2, 0, 0, 1] }}
                onClick={() => setSelected(security)}
                className="bubble-group"
                role="button"
                tabIndex={0}
                onKeyDown={(event) => event.key === "Enter" && setSelected(security)}
              >
                {security.insiderSignal && <circle cx={x} cy={y} r={r + 7} className="bubble-insider-ring" />}
                <circle cx={x} cy={y} r={r} className={`bubble ${positive ? "positive" : "negative"} ${selected?.id === security.id ? "selected" : ""}`} />
                <text x={x} y={y + 4} textAnchor="middle" className="bubble-label">{security.ticker}</text>
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
              <button className="inspector-close" onClick={() => setSelected(null)} aria-label="Close security inspector"><X size={14} /></button>
              <span className="ticker-chip">{selected.ticker}</span>
              <h3>{selected.issuer}</h3>
              <p>{selected.sector} · {selected.figi}</p>
              <dl>
                <div><dt>Reported holders</dt><dd>{selected.holderCount}</dd></div>
                <div><dt>Quarter flow</dt><dd className={selected.netFlow >= 0 ? "up" : "down"}>{formatMoney(selected.netFlow)}</dd></div>
                <div><dt>Aggregate value</dt><dd>{formatMoney(selected.aggregateValue)}</dd></div>
              </dl>
              {selected.insiderSignal && <div className="signal-note"><BadgeCheck size={15} /> Open-market insider buy overlaps</div>}
              <button className="text-button">Open security dossier <span>→</span></button>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
