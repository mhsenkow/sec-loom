import { motion } from "framer-motion";
import { ArrowRight, Bot, ChevronRight, CircleDollarSign, FileCheck2, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { useData } from "../data/DataContext";
import { managerBreadthRows } from "../data/chartData";
import { formatMoney, formatUsd, securityDisplay } from "../utils/format";

export function SupportingPanels() {
  const { insiderTrades, managers, holdingDiffs, isLive, isContinuous, coveragePct } = useData();

  const activeManagers = useMemo(
    () => managerBreadthRows(managers, holdingDiffs, 3),
    [managers, holdingDiffs],
  );

  return (
    <div className="support-grid">
      <section className="support-panel pulse-panel">
        <header>
          <div>
            <span className="eyebrow">Portfolio pulse</span>
            <h2>Managers in motion</h2>
          </div>
          <button className="text-button" type="button">All managers <ArrowRight size={14} /></button>
        </header>
        <div className="pulse-list">
          {activeManagers.length === 0 ? (
            <div className="empty-signal">
              <strong>No active managers in sample</strong>
              <p>Top-move diffs did not include manager activity yet.</p>
            </div>
          ) : (
            activeManagers.map((manager, index) => (
              <motion.article
                key={manager.cik}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.06 }}
              >
                <div className="manager-avatar">{manager.shortName.slice(0, 2).toUpperCase()}</div>
                <div className="pulse-copy">
                  <div className="pulse-title">
                    <strong>{manager.name}</strong>
                    <span>{formatMoney(manager.aum)} 13F</span>
                  </div>
                  <p>{manager.brief}</p>
                  <div className="pulse-meta">
                    <span>
                      <Sparkles size={12} />{" "}
                      {manager.breadth >= 0 ? `+${manager.breadth}` : manager.breadth} breadth
                    </span>
                    <span>
                      <FileCheck2 size={12} />{" "}
                      {manager.coverage != null
                        ? `${manager.coverage.toFixed(1)}% manager coverage`
                        : coveragePct != null
                          ? `${coveragePct.toFixed(1)}% dataset coverage`
                          : isLive
                            ? "Filing summary"
                            : "Demo summary"}
                    </span>
                  </div>
                </div>
                <ChevronRight size={16} className="chevron" aria-hidden="true" />
              </motion.article>
            ))
          )}
        </div>
      </section>

      <section className="support-panel insider-panel">
        <header>
          <div>
            <span className="eyebrow">Form 4 signal</span>
            <h2>Insider buy wire</h2>
          </div>
          <span className={`code-chip ${isContinuous ? "" : "muted"}`}>
            {isContinuous ? "LIVE" : "CODE P"}
          </span>
        </header>
        <p className="section-intro">
          Open-market purchases only. Grants, options, and tax dispositions filtered out.
        </p>
        <div className="insider-list">
          {insiderTrades.length === 0 ? (
            <div className="empty-signal">
              <strong>No open-market buys in window</strong>
              <p>Form 4 code P purchases will appear here when available.</p>
            </div>
          ) : (
            insiderTrades.map((trade, index) => (
              <article key={`${trade.accession}-${trade.insider}-${trade.date}-${index}`}>
                <div className="trade-ticker" title={trade.issuer}>
                  {trade.ticker ?? securityDisplay({ ticker: null, issuer: trade.issuer })}
                </div>
                <div>
                  <strong>{trade.insider}</strong>
                  <span>{trade.role}</span>
                </div>
                <div className="trade-value">
                  <strong>{formatUsd(trade.value, true)}</strong>
                  <span>{trade.date}</span>
                </div>
              </article>
            ))
          )}
        </div>
        <button className="full-button" type="button">
          <CircleDollarSign size={15} /> Browse all insider buys <ArrowRight size={14} />
        </button>
      </section>

      <section className="support-panel query-panel">
        <div className="query-mark"><Bot size={20} /></div>
        <div>
          <span className="eyebrow">Ask the loom</span>
          <h2>Query filings in plain English</h2>
          <p>Translated into validated filters — never free-form SQL.</p>
        </div>
        <form onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="loom-query" className="sr-only">Natural language filing query</label>
          <input id="loom-query" defaultValue="Stocks 3+ managers bought while insiders also bought" />
          <button type="submit">Run query <ArrowRight size={14} /></button>
        </form>
        <small><FileCheck2 size={12} /> Results will include filing citations and coverage stats.</small>
      </section>
    </div>
  );
}
