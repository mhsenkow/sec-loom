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
import {
  actionMix as buildActionMix,
  concentrationRows,
  coverageFrom,
  crowdingUniverse,
  hasSectorCoverage,
  managerBreadthRows,
  sectorFlows,
  securityLeaders,
  topMoves,
} from "../data/chartData";
import { formatCount, formatMoney, formatPercent, securityDisplay } from "../utils/format";
import {
  bubbleRadius,
  clamp,
  extent,
  linearScale,
  percentile,
  robustWidth,
} from "../utils/scales";
import type { HoldingDiff, Security } from "../types";

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
  const { holdingDiffs, managers, securities, sampleNote, aggregates } = useData();
  const [activeTab, setActiveTab] = useState<InsightTab>("rotation");
  const reduceMotion = useReducedMotion();

  const coverage = useMemo(
    () => coverageFrom(securities, holdingDiffs, managers),
    [securities, holdingDiffs, managers],
  );
  const movers = useMemo(
    () => topMoves(holdingDiffs, managers, securities, 7),
    [holdingDiffs, managers, securities],
  );
  const useSectors = hasSectorCoverage(securities);
  const sectors = useMemo(() => sectorFlows(securities, 7), [securities]);
  const leaders = useMemo(() => securityLeaders(securities, 7), [securities]);
  const managerBreadth = useMemo(
    () => managerBreadthRows(managers, holdingDiffs, 6),
    [managers, holdingDiffs],
  );
  const crowding = useMemo(() => crowdingUniverse(securities, 12), [securities]);
  const concentration = useMemo(() => concentrationRows(securities, 5), [securities]);
  const actionMix = useMemo(() => {
    if (aggregates?.actionMix) {
      const counts = aggregates.actionMix;
      const activeTotal = counts.activeTotal || counts.NEW + counts.ADD + counts.TRIM + counts.EXIT;
      return {
        counts,
        total: holdingDiffs.length,
        activeTotal,
        accumulation: counts.NEW + counts.ADD,
        distribution: counts.TRIM + counts.EXIT,
        accumulationShare: activeTotal > 0 ? (counts.NEW + counts.ADD) / activeTotal : 0,
      };
    }
    return buildActionMix(holdingDiffs);
  }, [aggregates, holdingDiffs]);

  const overlaps = useMemo(() => {
    return securities
      .filter((security) => security.insiderSignal && (security.netFlow ?? 0) > 0)
      .map((security) => {
        const adds = holdingDiffs.filter(
          (diff) =>
            diff.securityId === security.id &&
            (diff.action === "NEW" || diff.action === "ADD"),
        ).length;
        return {
          ...security,
          adds,
          score: adds * 2 + Math.min(security.holderCount, 10),
          label: securityDisplay(security),
        };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
  }, [holdingDiffs, securities]);

  const stories = useMemo(() => {
    const strongestSector = sectors.find((item) => item.netFlow > 0);
    const weakestSector = [...sectors]
      .filter((item) => item.netFlow < 0)
      .sort((a, b) => a.netFlow - b.netFlow)[0];
    const netAdders = managerBreadth.filter((manager) => manager.breadth > 0).length;
    const mostCrowded = [...crowding].sort((a, b) => b.holderCount - a.holderCount)[0];
    const strongestFlow = [...crowding]
      .filter((item) => item.netFlow != null)
      .sort((a, b) => (b.netFlow ?? 0) - (a.netFlow ?? 0))[0];

    return {
      rotation: useSectors
        ? `${strongestSector?.sector ?? "Leaders"} led reported value change${
            weakestSector
              ? ` while ${weakestSector.sector} gave back ${formatMoney(Math.abs(weakestSector.netFlow))}`
              : ""
          }. ${netAdders} of ${managerBreadth.length} active managers were net accumulators by share-count actions.`
        : `Sector tags are unresolved for ${formatPercent(100 - coverage.sectorPct, 0)} of this sample, so this tab shows security leaders/laggards instead. ${netAdders} of ${managerBreadth.length} active managers were net accumulators by share-count actions.`,
      crowding: mostCrowded
        ? `${securityDisplay(mostCrowded)} is the broadest consensus holding at ${formatCount(mostCrowded.holderCount)} managers. ${
            strongestFlow ? securityDisplay(strongestFlow) : securityDisplay(mostCrowded)
          } has the strongest net reported value change among the crowded set.`
        : "Crowding needs resolved holder counts; this set will populate as identifier coverage improves.",
      confirmation:
        overlaps.length > 0
          ? `${overlaps.length} names combine positive institutional value change with a linked open-market insider purchase. ${Math.round(actionMix.accumulationShare * 100)}% of active actions were accumulation.`
          : coverage.tickerPct < 5
            ? `Insider confirmation needs issuer/ticker links. Ticker coverage in this sample is ${formatPercent(coverage.tickerPct, 0)}; Form 4 rows are present but not joinable yet.`
            : `No resolved name currently clears both confirmation tests. ${Math.round(actionMix.accumulationShare * 100)}% of active actions were accumulation.`,
    };
  }, [
    actionMix.accumulationShare,
    coverage.sectorPct,
    coverage.tickerPct,
    crowding,
    managerBreadth,
    overlaps,
    sectors,
    useSectors,
  ]);

  const maxMover = Math.max(...movers.map((item) => Math.abs(item.delta)), 1);
  const rotationRows = useSectors ? sectors : leaders;
  const maxRotation = Math.max(
    ...rotationRows.map((item) => Math.abs(item.netFlow ?? 0)),
    1,
  );
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
          transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.2, 0, 0, 1] }}
        >
          {activeTab === "rotation" && (
            <div className="chart-set-grid rotation-set">
              <article className="insight-panel movers-panel">
                <PanelHeader icon={Zap} eyebrow="Magnitude" title="Largest reported value moves" chip="click to cite" />
                {movers.length === 0 ? (
                  <div className="empty-signal"><strong>No moves</strong><p>No non-zero diffs in the sample.</p></div>
                ) : (
                  <div className="waterfall">
                    <div className="waterfall-axis"><span>Value down</span><span>Value up</span></div>
                    {movers.map((mover, index) => {
                      const positive = mover.delta >= 0;
                      const width = (robustWidth(mover.delta, maxMover, 8, 50));
                      return (
                        <button
                          key={`${mover.managerCik}-${mover.securityId}`}
                          className={`waterfall-row ${positive ? "up" : "down"}`}
                          onClick={() => onCite(mover)}
                        >
                          <div className="waterfall-meta">
                            <strong>{mover.label}</strong>
                            <span>{mover.managerLabel} · {mover.action}</span>
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
                )}
              </article>

              <div className="chart-set-stack">
                <article className="insight-panel compact-insight-panel">
                  <PanelHeader
                    icon={Radar}
                    eyebrow={useSectors ? "Direction" : "Fallback"}
                    title={useSectors ? "Sector rotation" : "Security leaders / laggards"}
                    chip={useSectors ? "net value Δ" : "sectors unresolved"}
                  />
                  <div className="rotation-bars">
                    {rotationRows.map((row, index) => {
                      const netFlow = row.netFlow ?? 0;
                      const positive = netFlow >= 0;
                      const width = (Math.abs(netFlow) / maxRotation) * 50;
                      const label =
                        "label" in row
                          ? row.label
                          : "sector" in row
                            ? row.sector
                            : securityDisplay(row as Security);
                      return (
                        <div className="rotation-row" key={label}>
                          <span title={label}>{label}</span>
                          <div className="rotation-track">
                            <motion.i
                              className={positive ? "positive" : "negative"}
                              initial={reduceMotion ? false : { width: 0 }}
                              animate={{ width: `${width}%` }}
                              transition={{ delay: reduceMotion ? 0 : index * 0.03, duration: reduceMotion ? 0 : 0.28 }}
                              style={{ [positive ? "left" : "right"]: "50%" }}
                            />
                            <b />
                          </div>
                          <strong className={positive ? "up" : "down"}>{formatMoney(netFlow)}</strong>
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
                          <small>{manager.adds}/{manager.cuts}</small>
                        </div>
                      );
                    })}
                  </div>
                </article>
              </div>
            </div>
          )}

          {activeTab === "crowding" && (
            <CrowdingSet
              crowding={crowding}
              concentration={concentration}
              reduceMotion={Boolean(reduceMotion)}
            />
          )}

          {activeTab === "confirmation" && (
            <ConfirmationSet
              actionMix={actionMix}
              overlaps={overlaps}
              coverage={coverage}
              reduceMotion={Boolean(reduceMotion)}
            />
          )}
        </motion.div>
        <p className="insight-footnote">{sampleNote}</p>
      </div>
    </section>
  );
}

function CrowdingSet({
  crowding,
  concentration,
  reduceMotion,
}: {
  crowding: Security[];
  concentration: Array<Security & { share: number; rank: number; label: string }>;
  reduceMotion: boolean;
}) {
  const holders = crowding.map((item) => item.holderCount);
  const flows = crowding.map((item) => item.netFlow ?? 0);
  const values = crowding.map((item) => item.aggregateValue);
  const holderDomain = extent(holders.length ? holders : [0, 1], 0.05);
  const flowDomain = extent(flows.length ? flows : [-1, 1], 0.08);
  const maxValue = Math.max(...values, 1);
  const holderMid = percentile(holders.length ? holders : [0], 0.5);

  return (
    <div className="chart-set-grid crowding-set">
      <article className="insight-panel crowding-panel">
        <PanelHeader icon={UsersRound} eyebrow="Consensus" title="Crowding × value change" chip="top aggregate value" />
        {crowding.length === 0 ? (
          <div className="empty-signal"><strong>No crowding sample</strong><p>Need holder counts and aggregate value.</p></div>
        ) : (
          <div className="crowding-plot">
            <svg viewBox="0 0 440 240" role="img" aria-label="Security crowding versus net reported value change">
              <rect x="36" y="20" width="384" height="89" className="crowding-zone positive-zone" />
              <rect x="36" y="109" width="384" height="89" className="crowding-zone negative-zone" />
              <line x1="36" x2="420" y1="109" y2="109" className="crowding-axis" />
              <line
                x1={linearScale(holderMid, holderDomain, [48, 404])}
                x2={linearScale(holderMid, holderDomain, [48, 404])}
                y1="20"
                y2="198"
                className="crowding-axis"
              />
              <text x="40" y="14" className="crowding-label">GAINING</text>
              <text x="414" y="14" textAnchor="end" className="crowding-label">CROWDED + GAINING</text>
              <text x="414" y="216" textAnchor="end" className="crowding-label">CROWDED + LOSING</text>
              <text x="228" y="232" textAnchor="middle" className="crowding-axis-title">HOLDER COUNT →</text>
              {crowding.map((security, index) => {
                let x = linearScale(security.holderCount, holderDomain, [48, 404]);
                let y = linearScale(security.netFlow ?? 0, flowDomain, [198, 20]);
                for (let i = 0; i < index; i += 1) {
                  const other = crowding[i];
                  const ox = linearScale(other.holderCount, holderDomain, [48, 404]);
                  const oy = linearScale(other.netFlow ?? 0, flowDomain, [198, 20]);
                  const dist = Math.hypot(x - ox, y - oy) || 0.01;
                  if (dist < 14) {
                    x += ((x - ox) / dist) * 4;
                    y += ((y - oy) / dist) * 4;
                  }
                }
                x = clamp(x, 48, 404);
                y = clamp(y, 28, 190);
                const radius = bubbleRadius(security.aggregateValue, maxValue, 5, 16);
                return (
                  <motion.g
                    key={security.id}
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: reduceMotion ? 0 : index * 0.02, duration: 0.22 }}
                  >
                    <title>
                      {securityDisplay(security)} · {security.holderCount} holders · {formatMoney(security.netFlow ?? 0)}
                    </title>
                    <circle
                      cx={x}
                      cy={y}
                      r={radius}
                      className={(security.netFlow ?? 0) >= 0 ? "crowding-bubble positive" : "crowding-bubble negative"}
                    />
                    {index < 8 && (
                      <text x={x} y={y + 2} textAnchor="middle" className="crowding-ticker">
                        {securityDisplay(security).slice(0, 7)}
                      </text>
                    )}
                  </motion.g>
                );
              })}
            </svg>
          </div>
        )}
      </article>

      <article className="insight-panel concentration-panel">
        <PanelHeader icon={Layers3} eyebrow="Weight" title="Consensus concentration" chip="share of top sample" />
        <div className="concentration-list">
          {concentration.map((security, index) => (
            <div className="concentration-row" key={security.id}>
              <span className="concentration-rank">{String(security.rank).padStart(2, "0")}</span>
              <div>
                <strong>{security.label}</strong>
                <span>
                  {formatCount(security.holderCount)} holders · {formatMoney(security.netFlow ?? 0)} Δ
                </span>
              </div>
              <div className="concentration-meter">
                <motion.i
                  initial={reduceMotion ? false : { width: 0 }}
                  animate={{ width: `${Math.max(security.share * 100, 2)}%` }}
                  transition={{ delay: reduceMotion ? 0 : index * 0.04, duration: reduceMotion ? 0 : 0.3 }}
                />
              </div>
              <b>{Math.round(security.share * 100)}%</b>
            </div>
          ))}
        </div>
        <p className="chart-footnote">Share is of the top crowded sample by aggregate value, not the full market.</p>
      </article>
    </div>
  );
}

function ConfirmationSet({
  actionMix,
  overlaps,
  coverage,
  reduceMotion,
}: {
  actionMix: ReturnType<typeof buildActionMix>;
  overlaps: Array<Security & { adds: number; score: number; label: string }>;
  coverage: ReturnType<typeof coverageFrom>;
  reduceMotion: boolean;
}) {
  const segments = [
    { key: "NEW", color: "var(--positive)", value: actionMix.counts.NEW },
    { key: "ADD", color: "var(--accent)", value: actionMix.counts.ADD },
    { key: "TRIM", color: "var(--sun)", value: actionMix.counts.TRIM },
    { key: "EXIT", color: "var(--negative)", value: actionMix.counts.EXIT },
  ];
  const circumference = 2 * Math.PI * 46;
  const arcs = segments.reduce<Array<(typeof segments)[number] & { offset: number; length: number }>>(
    (items, segment) => {
      const length = (segment.value / Math.max(actionMix.activeTotal, 1)) * circumference;
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
        <PanelHeader icon={Radar} eyebrow="Regime" title="Accumulation vs distribution" chip="share actions" />
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
                    transition={{ duration: reduceMotion ? 0 : 0.5, ease: [0.2, 0, 0, 1] }}
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
              {actionMix.counts.HOLD > 0 && (
                <li>
                  <i style={{ background: "var(--text-faint)" }} />
                  <span>HOLD</span>
                  <strong>{actionMix.counts.HOLD}</strong>
                </li>
              )}
            </ul>
          </div>
          <div className="regime-balance">
            <span>Accumulation</span>
            <strong>{actionMix.accumulation}</strong>
            <i style={{ width: `${actionMix.accumulationShare * 100}%` }} />
            <span>Distribution</span>
            <strong>{actionMix.distribution}</strong>
          </div>
          <p className="chart-footnote">Ring excludes HOLD. Actions are share-count based, not dollar direction.</p>
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
              transition={{ delay: reduceMotion ? 0 : index * 0.04, duration: reduceMotion ? 0 : 0.2 }}
            >
              <div className="overlap-ticker">{item.label}</div>
              <div className="overlap-copy">
                <strong>{item.adds} managers accumulated</strong>
                <span>{formatMoney(item.netFlow ?? 0)} net value Δ · insider purchase linked</span>
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
              <p>
                {coverage.tickerPct < 5
                  ? `Ticker/issuer join coverage is ${formatPercent(coverage.tickerPct, 0)}. Form 4 buys exist, but cannot be linked to 13F names yet.`
                  : "No resolved security currently has both positive institutional value change and a linked open-market insider purchase."}
              </p>
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
