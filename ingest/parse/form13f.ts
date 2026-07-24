import { arrayOf, booleanValue, numberValue, parseXml, text } from "./xml";

interface XmlRecord {
  [key: string]: unknown;
}

export interface Parsed13FCover {
  periodOfReport: string;
  managerName?: string;
  isAmendment: boolean;
  amendmentNumber?: number;
  amendmentType?: string;
}

export interface ParsedHolding {
  lineNumber: number;
  cusip: string;
  issuerName: string;
  titleOfClass?: string;
  valueAsFiled: number;
  valueUsd: number;
  shares: number;
  shareType?: string;
  putCall?: string;
  investmentDiscretion?: string;
  votingSole?: number;
  votingShared?: number;
  votingNone?: number;
  otherManager?: string;
  raw: XmlRecord;
}

export function parse13FCover(xml: string): Parsed13FCover {
  const document = parseXml<XmlRecord>(xml);
  const submission = record(document.edgarSubmission ?? document);
  const formData = record(submission.formData);
  const cover = record(formData.coverPage);
  const filingManager = record(cover.filingManager);
  const amendmentInfo = record(cover.amendmentInfo);
  const period = text(cover.reportCalendarOrQuarter);
  if (!period) throw new Error("13F cover page is missing reportCalendarOrQuarter");

  return {
    periodOfReport: normalizeSecDate(period),
    managerName: text(filingManager.name),
    isAmendment: booleanValue(cover.isAmendment),
    amendmentNumber: numberValue(amendmentInfo.amendmentNumber),
    amendmentType: text(amendmentInfo.amendmentType),
  };
}

export function parse13FInformationTable(xml: string): ParsedHolding[] {
  const document = parseXml<XmlRecord>(xml);
  const table = record(document.informationTable ?? document);
  return arrayOf(table.infoTable as XmlRecord | XmlRecord[] | undefined).map(
    (raw, index) => {
      const sharesOrPrincipal = record(raw.shrsOrPrnAmt);
      const voting = record(raw.votingAuthority);
      const cusip = text(raw.cusip)?.toUpperCase().replaceAll(/\s/g, "");
      const issuerName = text(raw.nameOfIssuer);
      const valueAsFiled = numberValue(raw.value);
      const shares = numberValue(sharesOrPrincipal.sshPrnamt);

      if (!cusip || !issuerName || valueAsFiled === undefined || shares === undefined) {
        throw new Error(`13F information table row ${index + 1} is incomplete`);
      }

      return {
        lineNumber: index + 1,
        cusip,
        issuerName,
        titleOfClass: text(raw.titleOfClass),
        valueAsFiled,
        valueUsd: valueAsFiled,
        shares,
        shareType: text(sharesOrPrincipal.sshPrnamtType),
        putCall: text(raw.putCall),
        investmentDiscretion: text(raw.investmentDiscretion),
        votingSole: numberValue(voting.Sole),
        votingShared: numberValue(voting.Shared),
        votingNone: numberValue(voting.None),
        otherManager: text(raw.otherManager),
        raw,
      };
    },
  );
}

function record(value: unknown): XmlRecord {
  return value && typeof value === "object" ? (value as XmlRecord) : {};
}

function normalizeSecDate(value: string) {
  const compact = value.replaceAll(/[^0-9]/g, "");
  if (compact.length === 8) {
    const yearFirst = Number(compact.slice(0, 4)) > 1900;
    return yearFirst
      ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
      : `${compact.slice(4, 8)}-${compact.slice(0, 2)}-${compact.slice(2, 4)}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid SEC date: ${value}`);
  return parsed.toISOString().slice(0, 10);
}
