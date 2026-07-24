import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, CheckCircle2, Copy, ExternalLink, FileText, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useData } from "../data/DataContext";
import { formatMoney } from "../data/mockData";
import type { HoldingDiff } from "../types";

interface ProvenanceDialogProps {
  diff: HoldingDiff | null;
  onClose: () => void;
}

export function ProvenanceDialog({ diff, onClose }: ProvenanceDialogProps) {
  const { managers, securities, reportPeriod } = useData();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!diff) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [diff, onClose]);

  if (!diff) return null;
  const manager = managers.find((item) => item.cik === diff.managerCik);
  const security = securities.find((item) => item.id === diff.securityId);
  const edgarUrl = `https://www.sec.gov/Archives/edgar/data/${diff.managerCik.replace(/^0+/, "")}/${diff.accession.replaceAll("-", "")}/`;

  const copyCitation = async () => {
    await navigator.clipboard.writeText(
      `${manager?.name}, Form 13F-HR${diff.isAmendment ? "/A" : ""}, period ended ${reportPeriod}, filed ${diff.filedAt}, accession ${diff.accession}.`,
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <AnimatePresence>
      <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
        <motion.aside
          className="citation-dialog"
          initial={{ opacity: 0, x: 36, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 36, scale: 0.98 }}
          transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
          onMouseDown={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="citation-title"
        >
          <header>
            <div className="citation-icon"><FileText size={18} /></div>
            <div>
              <span className="eyebrow">Source thread</span>
              <h2 id="citation-title">Filing provenance</h2>
            </div>
            <button className="icon-button" onClick={onClose} aria-label="Close citation"><X size={16} /></button>
          </header>

          <div className="filing-stamp">
            <span>SEC EDGAR</span>
            <strong>{diff.isAmendment ? "13F-HR/A" : "13F-HR"}</strong>
            <small>As filed · not investment advice</small>
          </div>

          <div className="citation-subject">
            <div>
              <span>Manager</span>
              <strong>{manager?.name}</strong>
              <small>CIK {diff.managerCik}</small>
            </div>
            <ArrowUpRight size={18} />
            <div>
              <span>Security</span>
              <strong>{security?.ticker} · {security?.issuer}</strong>
              <small>{security?.figi}</small>
            </div>
          </div>

          <dl className="citation-values">
            <div><dt>As-filed value</dt><dd>{formatMoney(diff.value, true)}</dd></div>
            <div><dt>Previous value</dt><dd>{formatMoney(diff.previousValue, true)}</dd></div>
            <div><dt>Derived change</dt><dd className={diff.delta >= 0 ? "up" : "down"}>{formatMoney(diff.delta, true)}</dd></div>
            <div><dt>Shares reported</dt><dd>{diff.shares.toLocaleString()}</dd></div>
          </dl>

          <div className="accession-block">
            <span>Accession number</span>
            <code>{diff.accession}</code>
            <small>Filed {diff.filedAt} · period of report {reportPeriod}</small>
          </div>

          {diff.isAmendment && (
            <div className="amendment-note">
              <CheckCircle2 size={15} />
              Latest amendment applied. Original filing remains available in the audit history.
            </div>
          )}

          <footer>
            <button className="secondary-button" onClick={copyCitation}>
              {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
              {copied ? "Citation copied" : "Copy citation"}
            </button>
            <a className="primary-button" href={edgarUrl} target="_blank" rel="noreferrer">
              Open on EDGAR <ExternalLink size={14} />
            </a>
          </footer>
        </motion.aside>
      </motion.div>
    </AnimatePresence>
  );
}
