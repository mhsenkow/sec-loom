import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  Crosshair,
  Layers3,
  Radar,
  Route,
  UsersRound,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useData } from "../data/DataContext";
import { formatMoney } from "../data/mockData";
import type { HoldingDiff } from "../types";

interface InsightDeckProps {
  onCite: (diff: HoldingDiff) => void;
}

type InsightTab = "rotation" | "crowding" | "confirmation";

const tabs: Array<{
  id: InsightTab;
  label: string;
  kicker: string;
  icon: typeof Route;
}> = [
  { id: "rotation", label: "Rotation", kicker: "Where capital moved", icon: Route },
  { id: "crowding", label: "Crowding", kicker: "Where risk is building", icon: UsersRound },
  { id: "confirmation", label: "Confirmation", kicker: "Where signals agree", icon: Crosshair },
];

export function InsightDeck({ onCite }: InsightDeckProps) {
  const { holdingDiffs, managers, securities } = useData();
  const [activeTab, setActiveTab] = useState<InsightTab>("rotation");
  const reduceMotion = useReducedMotion();

  const movers = useMemo(() => {
    return [...holdingDiffs]
      .filter((diff) => diff.action !== "HOLD" && Math.abs(diff.delta) > 0)
      .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
      .slice(0, 7)
      .map((diff) => ({
        ...diff,
        manager: managers.find((item) => item.cik === diff.managerCik),
        security: securities.find((item) => item.id === diff.securityId),
      }));
  }, [holdingDiffs, managers, securities]);

  const sectors = useMemo(() => {
    const totals = new Map<string, number>();
    for (const security of securities) {
      totals.set(security.sector, (totals.get(security.sector) ?? 0) + security.netFlow);
    }
    return [...totals.entries()]
      .map(([sector, netFlow]) => ({ sector, netFlow }))
      .sort((left, right) => Math.abs(right.netFlow) - Math.abs(left.netFlow))
      .slice(0, 7);
  }, [securities]);

  const managerBreadth = useMemo(() => {
    return managers
      .map((manager) => {
        const diffs = holdingDiffs.filter((diff) => diff.managerCik === manager.cik);
        const adds = diffs.filter((diff) => diff.action === "NEW" || diff.action === "ADD").length;
        const cuts = diffs.filter((diff) => diff.action === "TRIM" || diff.action === "EXIT").length;
        return {
          ...manager,
          adds,
          cuts,
          breadth: adds - cuts,
          netFlow: diffs.reduce((sum, diff) => sum + diff.delta, 0),
        };
      })
      .filter((manager) => manager.adds + manager.cuts > 0)
      .sort((left, right) => Math.abs(right.breadth) - Math.abs(left.breadth))
      .slice(0, 6);
  }, [holdingDiffs, managers]);

  const crowding = useMemo(() => {
    return securities
      .filter((security) => security.holderCount > 0 && security.aggregateValue > 0)
      .sort((left, right) => right.aggregateValue - left.aggregateValue)
      .slice(0, 12);
  }, [securities]);

  const concentration = useMemo(() => {
    const total = crowding.reduce((sum, security) => sum + security.aggregateValue, 0);
    return crowding.slice(0, 5).map((security) => ({
      ...security,
      share: total > 0 ? security.aggregateValue / total : 0,
    }));
  }, [crowding]);

  const actionMix = useMemo(() => {
    const counts = { NEW: 0, ADD: 0, TRIM: 0, EXIT: 0, HOLD: 0 };
    for (const diff of holdingDiffs) counts[diff.action] += 1;
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const accumulation = counts.NEW + counts.ADD;
    return {
      counts,
      total,
      accumulation,
      accumulationShare: total > 0 ? accumulation / total : 0,
    };
  }, [holdingDiffs]);

  const overlaps = useMemo(() => {
    return securities
      .filter((security) => security.insiderSignal && security.netFlow > 0)
      .map((security) => {
        const adds = holdingDiffs.filter(
          (diff) =>
            diff.securityId === security.id &&
            (diff.action === "NEW" || diff.action === "ADD"),
        ).length;
        return { ...security, adds, score: adds * 2 + Math.min(security.holderCount, 10) };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
  }, [holdingDiffs, securities]);

  const stories = useMemo(() => {
    const strongestSector = sectors.find((sector) => sector.netFlow > 0);
    const weakestSector = [...sectors].reverse().find((sector) => sector.netFlow < 0);
    const netAdders = managerBreadth.filter((manager) => manager.breadth > 0).length;
    const mostCrowded = [...crowding].sort(
      (left, right) => right.holderCount - left.holderCount,
    )[0];
    const strongestFlow = [...crowding].sort(
      (left, right) => right.netFlow - left.netFlow,
    )[0];

    return {
      rotation: strongestSector
        ? `${strongestSector.sector} led reported flow at ${formatMoney(strongestSector.netFlow)}${
            weakestSector
              ? ` while ${weakestSector.sector} gave back ${formatMoney(Math.abs(weakestSector.netFlow))}`
              : ""
          }. ${netAdders} of ${managerBreadth.length} active managers were net accumulators by position count.`
        : "Reported flow is concentrated in unresolved sector classifications; manager breadth remains the cleaner read.",
      crowding: mostCrowded
        ? `${mostCrowded.ticker} is the broadest consensus holding at ${mostCrowded.holderCount} managers. ${
            strongestFlow?.ticker ?? mostCrowded.ticker
          } has the strongest net flow; the lower-right quadrant highlights crowded names losing sponsorship.`
        : "Crowding requires resolved holder counts; this set will populate as identifier coverage improves.",
      confirmation:
        overlaps.length > 0
          ? `${overlaps.length} names combine positive institutional flow with an open-market insider purchase. ${Math.round(
              actionMix.accumulationShare * 100,
            )}% of reported actions were accumulation.`
          : `No resolved name currently clears both confirmation tests. ${Math.round(
              actionMix.accumulationShare * 100,
            )}% of reported actions were accumulation, but insider confirmation is absent.`,
    };
  }, [actionMix.accumulationShare, crowding, managerBreadth, overlaps, sectors]);

  const maxMover = Math.max(...movers.map((item) => Math.abs(item.delta)), 1);
  const maxSector = Math.max(...sectors.map((item) => Math.abs(item.netFlow)), 1);
  const maxBreadth = Math.max(...managerBreadth.map((item) => Math.abs(item.breadth)), 1);

  return (
    <section className="insight-deck" aria-labelledby="insight-deck-title">
      <header className="insight-deck-head">
        <div>
          <span className="eyebrow">Insight deck</span>
          <h2 id="insight-deck-title">Three reads, one quarter</h2>
        </div>
        <p>Each tab pairs charts that answer one research question—not a wall of widgets.</p>
      </header>

      <div className="insight-tabs-shell">
        <div className="insight-tablist" role="tablist" aria-label="Quarter insight stories">
          {tabs.map((tab, index) => {
            const Icon = tab.icon;
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                id={`insight-tab-${tab.id}`}
                role="tab"
                aria-selected={active}
                aria-controls={`insight-panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                className={`insight-tab ${active ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const direction = event.key === "ArrowRight" ? 1 : -1;
                  const next = (index + direction + tabs.length) % tabs.length;
                  setActiveTab(tabs[next].id);
                  document.getElementById(`insight-tab-${tabs[next].id}`)?.focus();
                }}
              >
                <Icon size={14} />
                <span>
                  <strong>{tab.label}</strong>
                  <small>{tab.kicker}</small>
                </span>
                {active && (
                  <motion.i
                    layoutId="insight-tab-indicator"
                    transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.2, 0, 0, 1] }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="insight-story" aria-live="polite">
          <Zap size={14} />
          <span>Quarter story</span>
          <p>{stories[activeTab]}</p>
        </div>

        <motion.div
          key={activeTab}
          id={`insight-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`insight-tab-${activeTab}`}
          className="insight-tab-panel"
          initial={reduceMotion ? false : { opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.2, 0, 0, 1] }}
        >
          {activeTab === "rotation" && (
            <RotationSet
              movers={movers}
              maxMover={maxMover}
              sectors={sectors}
              maxSector={maxSector}
              managerBreadth={managerBreadth}
              maxBreadth={maxBreadth}
              onCite={onCite}
              reduceMotion={Boolean(reduceMotion)}
            />
          )}
          {activeTab === "crowding" && (
            <CrowdingSet crowding={crowding} concentration={concentration} />
          )}
          {activeTab === "confirmation" && (
            <ConfirmationSet actionMix={actionMix} overlaps={overlaps} reduceMotion={Boolean(reduceMotion)} />
          )}
        </motion.div>
      </div>
    </section>
  );
}

interface Mover extends HoldingDiff {
  manager?: ReturnType<typeof useData>["managers"][number];
  security?: ReturnType<typeof useData>["securities"][number];
}

interface RotationSetProps {
  movers: Mover[];
  maxMover: number;
  sectors: Array<{ sector: string; netFlow: number }>;
  maxSector: number;
  managerBreadth: Array<ReturnType<typeof useData>["managers"][number] & {
    adds: number;
    cuts: number;
    breadth: number;
    netFlow: number;
  }>;
  maxBreadth: number;
  onCite: (diff: HoldingDiff) => void;
  reduceMotion: boolean;
}

function RotationSet({
  movers,
  maxMover,
  sectors,
  maxSector,
  managerBreadth,
  maxBreadth,
  onCite,
  reduceMotion,
}: RotationSetProps) {
  return (
    <div className="chart-set-grid rotation-set">
      <article className="insight-panel movers-panel">
        <PanelHeader icon={Zap} eyebrow="Magnitude" title="Largest reported moves" chip="click to cite" />
        <div className="waterfall">
          <div className="waterfall-axis"><span>Exit / Trim</span><span>Add / New</span></div>
          {movers.map((mover, index) => {
            const positive = mover.delta >= 0;
            const width = (Math.abs(mover.delta) / maxMover) * 50;
            return (
              <button
                key={`${mover.managerCik}-${mover.securityId}`}
                className={`waterfall-row ${positive ? "up" : "down"}`}
                onClick={() => onCite(mover)}
              >
                <div className="waterfall-meta">
                  <strong>{mover.security?.ticker ?? "UNRES"}</strong>
                  <span>{mover.manager?.shortName ?? mover.managerCik}</span>
                </div>
                <div className="waterfall-track">
                  <motion.i
                    className="waterfall-bar"
                    initial={reduceMotion ? false : { width: 0 }}
                    animate={{ width: `${width}%` }}
                    transition={{ delay: reduceMotion ? 0 : index * 0.025, duration: reduceMotion ? 0 : 0.32 }}
                    style={{ [positive ? "left" : "right"]: "50%" }}
                  />
                  <span className="waterfall-zero" />
                </div>
                <div className="waterfall-value">
                  {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  {formatMoney(mover.delta, true)}
                </div>
              </button>
            );
          })}
        </div>
      </article>

      <div className="chart-set-stack">
        <article className="insight-panel compact-insight-panel">
          <PanelHeader icon={Radar} eyebrow="Direction" title="Sector rotation" chip="net flow" />
          <div className="rotation-bars">
            {sectors.map((sector, index) => {
              const positive = sector.netFlow >= 0;
              const width = (Math.abs(sector.netFlow) / maxSector) * 50;
              return (
                <div className="rotation-row" key={sector.sector}>
                  <span>{sector.sector}</span>
                  <div className="rotation-track">
                    <motion.i
                      className={positive ? "positive" : "negative"}
                      initial={reduceMotion ? false : { width: 0 }}
                      animate={{ width: `${width}%` }}
                      transition={{ delay: reduceMotion ? 0 : index * 0.035, duration: reduceMotion ? 0 : 0.3 }}
                      style={{ [positive ? "left" : "right"]: "50%" }}
                    />
                    <b />
                  </div>
                  <strong className={positive ? "up" : "down"}>{formatMoney(sector.netFlow)}</strong>
                </div>
              );
            })}
          </div>
        </article>

        <article className="insight-panel compact-insight-panel">
          <PanelHeader icon={Layers3} eyebrow="Breadth" title="Manager participation" chip="adds − cuts" />
          <div className="breadth-list">
            {managerBreadth.map((manager) => {
              const positive = manager.breadth >= 0;
              return (
                <div className="breadth-row" key={manager.cik}>
                  <span>{manager.shortName}</span>
                  <div className="breadth-track">
                    <i
                      className={positive ? "positive" : "negative"}
                      style={{ width: `${(Math.abs(manager.breadth) / maxBreadth) * 100}%` }}
                    />
                  </div>
                  <strong className={positive ? "up" : "down"}>
                    {positive ? "+" : ""}{manager.breadth}
                  </strong>
                  <small>{manager.adds} / {manager.cuts}</small>
                </div>
              );
            })}
          </div>
        </article>
      </div>
    </div>
  );
}

interface CrowdingSetProps {
  crowding: ReturnType<typeof useData>["securities"];
  concentration: Array<ReturnType<typeof useData>["securities"][number] & { share: number }>;
}

function CrowdingSet({ crowding, concentration }: CrowdingSetProps) {
  const maxHolders = Math.max(...crowding.map((security) => security.holderCount), 1);
  const maxFlow = Math.max(...crowding.map((security) => Math.abs(security.netFlow)), 1);
  const maxValue = Math.max(...crowding.map((security) => security.aggregateValue), 1);

  return (
    <div className="chart-set-grid crowding-set">
      <article className="insight-panel crowding-panel">
        <PanelHeader icon={UsersRound} eyebrow="Consensus" title="Crowding × flow map" chip="bubble = reported value" />
        <div className="crowding-plot">
          <svg viewBox="0 0 440 240" role="img" aria-label="Security crowding versus net flow">
            <rect x="36" y="20" width="384" height="178" className="crowding-zone positive-zone" />
            <rect x="36" y="109" width="384" height="89" className="crowding-zone negative-zone" />
            <line x1="36" x2="420" y1="109" y2="109" className="crowding-axis" />
            <line x1="228" x2="228" y1="20" y2="198" className="crowding-axis" />
            <text x="40" y="14" className="crowding-label">EMERGING</text>
            <text x="414" y="14" textAnchor="end" className="crowding-label">CROWDED + GAINING</text>
            <text x="414" y="216" textAnchor="end" className="crowding-label">CROWDED + LOSING</text>
            <text x="228" y="232" textAnchor="middle" className="crowding-axis-title">HOLDER COUNT →</text>
            {crowding.map((security, index) => {
              const x = 48 + (security.holderCount / maxHolders) * 356;
              const y = 109 - (security.netFlow / maxFlow) * 76;
              const radius = 5 + Math.sqrt(security.aggregateValue / maxValue) * 12;
              return (
                <motion.g
                  key={security.id}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.025, duration: 0.25 }}
                  style={{ transformOrigin: `${x}px ${y}px` }}
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={radius}
                    className={security.netFlow >= 0 ? "crowding-bubble positive" : "crowding-bubble negative"}
                  />
                  <text x={x} y={y + 2} textAnchor="middle" className="crowding-ticker">
                    {security.ticker.slice(0, 7)}
                  </text>
                </motion.g>
              );
            })}
          </svg>
        </div>
      </article>

      <article className="insight-panel concentration-panel">
        <PanelHeader icon={Layers3} eyebrow="Weight" title="Consensus concentration" chip="share of shown value" />
        <div className="concentration-list">
          {concentration.map((security, index) => (
            <div className="concentration-row" key={security.id}>
              <span className="concentration-rank">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{security.ticker}</strong>
                <span>{security.holderCount} holders · {formatMoney(security.netFlow)} flow</span>
              </div>
              <div className="concentration-meter">
                <motion.i
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(security.share * 100, 2)}%` }}
                  transition={{ delay: index * 0.05, duration: 0.35 }}
                />
              </div>
              <b>{Math.round(security.share * 100)}%</b>
            </div>
          ))}
        </div>
        <p className="chart-footnote">A crowded name with falling flow is a monitoring flag, not a sell signal.</p>
      </article>
    </div>
  );
}

interface ConfirmationSetProps {
  actionMix: {
    counts: { NEW: number; ADD: number; TRIM: number; EXIT: number; HOLD: number };
    total: number;
    accumulation: number;
    accumulationShare: number;
  };
  overlaps: Array<ReturnType<typeof useData>["securities"][number] & {
    adds: number;
    score: number;
  }>;
  reduceMotion: boolean;
}

function ConfirmationSet({ actionMix, overlaps, reduceMotion }: ConfirmationSetProps) {
  const segments = [
    { key: "NEW", color: "var(--positive)", value: actionMix.counts.NEW },
    { key: "ADD", color: "var(--accent)", value: actionMix.counts.ADD },
    { key: "TRIM", color: "var(--sun)", value: actionMix.counts.TRIM },
    { key: "EXIT", color: "var(--negative)", value: actionMix.counts.EXIT },
  ];
  const circumference = 2 * Math.PI * 46;
  const arcs = segments.reduce<Array<(typeof segments)[number] & { offset: number; length: number }>>(
    (items, segment) => {
      const length = (segment.value / Math.max(actionMix.total, 1)) * circumference;
      items.push({
        ...segment,
        offset: items.reduce((sum, item) => sum + item.length, 0),
        length,
      });
      return items;
    },
    [],
  );

  return (
    <div className="chart-set-grid confirmation-set">
      <article className="insight-panel action-panel">
        <PanelHeader icon={Radar} eyebrow="Regime" title="Accumulation vs distribution" chip="position actions" />
        <div className="confirmation-mix">
          <div className="mix-ring-wrap">
            <svg viewBox="0 0 120 120" aria-label={`${Math.round(actionMix.accumulationShare * 100)} percent accumulation`}>
              <circle cx="60" cy="60" r="46" className="mix-track" />
              {arcs.map((segment) => {
                const dash = `${segment.length} ${circumference - segment.length}`;
                return (
                  <motion.circle
                    key={segment.key}
                    cx="60"
                    cy="60"
                    r="46"
                    fill="none"
                    stroke={segment.color}
                    strokeWidth="12"
                    strokeDasharray={dash}
                    strokeDashoffset={-segment.offset}
                    transform="rotate(-90 60 60)"
                    initial={reduceMotion ? false : { strokeDasharray: `0 ${circumference}` }}
                    animate={{ strokeDasharray: dash }}
                    transition={{ duration: reduceMotion ? 0 : 0.55, ease: [0.2, 0, 0, 1] }}
                  />
                );
              })}
              <text x="60" y="54" textAnchor="middle" className="mix-center-label">ACCUM.</text>
              <text x="60" y="72" textAnchor="middle" className="mix-center-value">
                {Math.round(actionMix.accumulationShare * 100)}%
              </text>
            </svg>
            <ul className="mix-legend">
              {segments.map((segment) => (
                <li key={segment.key}>
                  <i style={{ background: segment.color }} />
                  <span>{segment.key}</span>
                  <strong>{segment.value}</strong>
                </li>
              ))}
            </ul>
          </div>
          <div className="regime-balance">
            <span>Accumulation</span>
            <strong>{actionMix.accumulation}</strong>
            <i style={{ width: `${actionMix.accumulationShare * 100}%` }} />
            <span>Distribution</span>
            <strong>{actionMix.counts.TRIM + actionMix.counts.EXIT}</strong>
          </div>
        </div>
      </article>

      <article className="insight-panel overlap-panel">
        <PanelHeader icon={Crosshair} eyebrow="Cross-signal" title="Institutional × insider" chip="Form 4 code P" />
        <div className="overlap-stack">
          {overlaps.length > 0 ? overlaps.map((item, index) => (
            <motion.div
              key={item.id}
              className="overlap-row"
              initial={reduceMotion ? false : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reduceMotion ? 0 : index * 0.045, duration: reduceMotion ? 0 : 0.22 }}
            >
              <div className="overlap-ticker">{item.ticker}</div>
              <div className="overlap-copy">
                <strong>{item.adds} managers accumulated</strong>
                <span>{formatMoney(item.netFlow)} net flow · insider purchase filed</span>
              </div>
              <div className="overlap-score">
                <small>signal</small>
                <b>{item.score}</b>
              </div>
              <div className="overlap-bars" aria-hidden="true">
                <i style={{ width: `${Math.min(item.adds * 15, 100)}%` }} />
                <i className="insider" />
              </div>
            </motion.div>
          )) : (
            <div className="empty-signal">
              <Crosshair size={24} />
              <strong>No confirmed overlap</strong>
              <p>No resolved security currently has both positive institutional flow and an open-market insider purchase.</p>
            </div>
          )}
          <p className="overlap-note">Confirmation raises research priority; it is not a recommendation.</p>
        </div>
      </article>
    </div>
  );
}

function PanelHeader({
  icon: Icon,
  eyebrow,
  title,
  chip,
}: {
  icon: typeof Zap;
  eyebrow: string;
  title: string;
  chip: string;
}) {
  return (
    <header>
      <div>
        <span className="eyebrow"><Icon size={11} /> {eyebrow}</span>
        <h3>{title}</h3>
      </div>
      <span className="insight-chip">{chip}</span>
    </header>
  );
}
