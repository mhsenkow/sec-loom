import { arrayOf, booleanValue, numberValue, parseXml, text } from "./xml";

interface XmlRecord {
  [key: string]: unknown;
}

export interface ParsedForm4 {
  issuerCik: string;
  issuerName: string;
  issuerTradingSymbol?: string;
  ownerCik?: string;
  ownerName: string;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  officerTitle?: string;
  transactions: ParsedInsiderTransaction[];
}

export interface ParsedInsiderTransaction {
  index: number;
  transactionDate: string;
  transactionCode: string;
  shares?: number;
  price?: number;
  valueUsd?: number;
  acquiredDisposed?: string;
  ownershipAfter?: number;
  ownershipNature?: string;
  isOpenMarket: boolean;
  is10b51?: boolean;
  securityTitle?: string;
  footnotes: Array<{ id?: string; text?: string }>;
  raw: XmlRecord;
}

export function parseForm4(xml: string): ParsedForm4 {
  const document = parseXml<XmlRecord>(xml);
  const ownership = record(document.ownershipDocument ?? document);
  const issuer = record(ownership.issuer);
  const owners = arrayOf(
    ownership.reportingOwner as XmlRecord | XmlRecord[] | undefined,
  );
  const owner = record(owners[0]);
  const ownerId = record(owner.reportingOwnerId);
  const relationship = record(owner.reportingOwnerRelationship);
  const nonDerivativeTable = record(ownership.nonDerivativeTable);
  const rawTransactions = arrayOf(
    nonDerivativeTable.nonDerivativeTransaction as
      | XmlRecord
      | XmlRecord[]
      | undefined,
  );
  const footnotes = arrayOf(
    record(ownership.footnotes).footnote as XmlRecord | XmlRecord[] | undefined,
  ).map((footnote) => ({
    id: text(footnote["@_id"]),
    text: text(footnote),
  }));

  const issuerCik = normalizeCik(text(issuer.issuerCik));
  const issuerName = text(issuer.issuerName);
  const ownerName = text(ownerId.rptOwnerName);
  if (!issuerCik || !issuerName || !ownerName) {
    throw new Error("Form 4 is missing issuer or reporting owner identity");
  }

  return {
    issuerCik,
    issuerName,
    issuerTradingSymbol: text(issuer.issuerTradingSymbol),
    ownerCik: normalizeCik(text(ownerId.rptOwnerCik)),
    ownerName,
    isDirector: booleanValue(relationship.isDirector),
    isOfficer: booleanValue(relationship.isOfficer),
    isTenPercentOwner: booleanValue(relationship.isTenPercentOwner),
    officerTitle: text(relationship.officerTitle),
    transactions: rawTransactions.map((transaction, index) => {
      const coding = record(transaction.transactionCoding);
      const amounts = record(transaction.transactionAmounts);
      const post = record(transaction.postTransactionAmounts);
      const ownershipNature = record(transaction.ownershipNature);
      const transactionDate = normalizeDate(
        text(record(transaction.transactionDate).value),
      );
      const transactionCode = text(coding.transactionCode);
      if (!transactionDate || !transactionCode) {
        throw new Error(`Form 4 transaction ${index + 1} has no date or code`);
      }
      const shares = numberValue(record(amounts.transactionShares).value);
      const price = numberValue(record(amounts.transactionPricePerShare).value);
      const acquiredDisposed = text(
        record(amounts.transactionAcquiredDisposedCode).value,
      );
      return {
        index: index + 1,
        transactionDate,
        transactionCode,
        shares,
        price,
        valueUsd: shares !== undefined && price !== undefined ? shares * price : undefined,
        acquiredDisposed,
        ownershipAfter: numberValue(
          record(post.sharesOwnedFollowingTransaction).value,
        ),
        ownershipNature: text(
          record(ownershipNature.directOrIndirectOwnership).value,
        ),
        isOpenMarket: transactionCode === "P" || transactionCode === "S",
        is10b51: booleanValue(coding.aff10b5One),
        securityTitle: text(record(transaction.securityTitle).value),
        footnotes,
        raw: transaction,
      };
    }),
  };
}

function record(value: unknown): XmlRecord {
  return value && typeof value === "object" ? (value as XmlRecord) : {};
}

function normalizeCik(value: string | undefined) {
  if (!value) return undefined;
  return value.replaceAll(/\D/g, "").padStart(10, "0");
}

function normalizeDate(value: string | undefined) {
  if (!value) return undefined;
  const isoDate = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return isoDate ?? value;
}
