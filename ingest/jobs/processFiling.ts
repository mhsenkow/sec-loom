import type pg from "pg";
import type { RawArchive } from "../lib/archive";
import type { Logger } from "../lib/logger";
import type { SecClient, SecIndexEntry } from "../lib/sec";
import { parse13FCover, parse13FInformationTable } from "../parse/form13f";
import { parseForm4 } from "../parse/form4";

interface ArchivedDocument {
  sequence: number;
  filename: string;
  documentType?: string;
  contentType: string;
  objectKey: string;
  sha256: string;
  byteSize: number;
  text: string;
}

export async function processFiling(
  pool: pg.Pool,
  sec: SecClient,
  archive: RawArchive,
  entry: SecIndexEntry,
  logger: Logger,
) {
  const existing = await pool.query(
    "SELECT 1 FROM filings WHERE accession_number = $1",
    [entry.accessionNumber],
  );
  if (existing.rowCount) return { status: "skipped" as const };

  const { baseUrl, items } = await sec.filingIndex(entry.cik, entry.accessionNumber);
  const submissionUrl = `https://www.sec.gov/Archives/${entry.filename}`;
  const submissionBody = await sec.bytes(submissionUrl, 50_000_000);
  const archivePrefix = `edgar/${entry.filedDate}/${entry.accessionNumber}`;
  const submissionArchive = await archive.putImmutable(
    `${archivePrefix}/submission.txt`,
    submissionBody,
    "text/plain",
  );

  const xmlItems = items
    .filter((item) => item.name.toLowerCase().endsWith(".xml"))
    .slice(0, 12);

  const documents: ArchivedDocument[] = [];
  for (let index = 0; index < xmlItems.length; index += 1) {
    const item = xmlItems[index];
    const bytes = await sec.bytes(`${baseUrl}/${item.name}`, 20_000_000);
    const archived = await archive.putImmutable(
      `${archivePrefix}/${item.name}`,
      bytes,
      "application/xml",
    );
    documents.push({
      sequence: index + 1,
      filename: item.name,
      documentType: item.type,
      contentType: "application/xml",
      objectKey: archived.key,
      sha256: archived.sha256,
      byteSize: archived.byteSize,
      text: new TextDecoder().decode(bytes),
    });
  }

  if (entry.formType === "13F-HR" || entry.formType === "13F-HR/A") {
    const result = await store13F(
      pool,
      entry,
      documents,
      submissionArchive.key,
      submissionUrl,
    );
    logger.info("filing_ingested", {
      accession: entry.accessionNumber,
      form: entry.formType,
      rows: result.rows,
    });
    return { status: "processed" as const, ...result };
  }

  if (["3", "3/A", "4", "4/A", "5", "5/A"].includes(entry.formType)) {
    const result = await storeOwnership(
      pool,
      entry,
      documents,
      submissionArchive.key,
      submissionUrl,
    );
    logger.info("filing_ingested", {
      accession: entry.accessionNumber,
      form: entry.formType,
      rows: result.rows,
    });
    return { status: "processed" as const, ...result };
  }

  return { status: "skipped" as const };
}

async function store13F(
  pool: pg.Pool,
  entry: SecIndexEntry,
  documents: ArchivedDocument[],
  rawObjectKey: string,
  sourceUrl: string,
) {
  const coverDocument = documents.find((document) =>
    /<\s*(?:\w+:)?edgarSubmission[\s>]/i.test(document.text),
  );
  const tableDocument = documents.find((document) =>
    /<\s*(?:\w+:)?informationTable[\s>]/i.test(document.text),
  );
  if (!coverDocument || !tableDocument) {
    throw new Error(`13F ${entry.accessionNumber} is missing cover or information table XML`);
  }
  const cover = parse13FCover(coverDocument.text);
  const holdings = parse13FInformationTable(tableDocument.text);
  const managerName = cover.managerName ?? entry.companyName;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertEntity(client, entry.cik, managerName, "MANAGER");
    await client.query(
      `
        INSERT INTO managers (cik)
        VALUES ($1)
        ON CONFLICT (cik) DO UPDATE SET is_active = true
      `,
      [entry.cik],
    );
    await client.query(
      `
        INSERT INTO filings (
          accession_number, filer_cik, form_type, filed_at, period_of_report,
          primary_document, is_amendment, amendment_number, amendment_type,
          raw_object_key, source_url, metadata
        )
        VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        entry.accessionNumber,
        entry.cik,
        entry.formType,
        entry.filedDate,
        cover.periodOfReport,
        coverDocument.filename,
        cover.isAmendment || entry.formType.endsWith("/A"),
        cover.amendmentNumber,
        cover.amendmentType,
        rawObjectKey,
        sourceUrl,
        JSON.stringify({ company_name_as_indexed: entry.companyName }),
      ],
    );
    await insertDocuments(client, entry.accessionNumber, documents);

    const cusipPriorities = new Map<string, number>();
    for (const holding of holdings) {
      cusipPriorities.set(
        holding.cusip,
        Math.max(cusipPriorities.get(holding.cusip) ?? 0, holding.valueUsd),
      );
    }
    for (const cusip of [...cusipPriorities.keys()].sort()) {
      await client.query(
        `
          INSERT INTO cusip_map (cusip)
          VALUES ($1)
          ON CONFLICT (cusip) DO NOTHING
        `,
        [cusip],
      );
    }

    for (const holding of holdings) {
      await client.query(
        `
          INSERT INTO holdings (
            accession_number, line_number, cusip, security_id,
            issuer_name_as_filed, title_of_class, value_as_filed,
            value_usd, shares, share_type, put_call, investment_discretion,
            voting_sole, voting_shared, voting_none, other_manager, as_filed_value
          )
          VALUES (
            $1, $2, $3,
            (SELECT security_id FROM cusip_map WHERE cusip = $3 AND status = 'RESOLVED'),
            $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
          )
        `,
        [
          entry.accessionNumber,
          holding.lineNumber,
          holding.cusip,
          holding.issuerName,
          holding.titleOfClass,
          holding.valueAsFiled,
          holding.valueUsd,
          holding.shares,
          holding.shareType,
          holding.putCall,
          holding.investmentDiscretion,
          holding.votingSole,
          holding.votingShared,
          holding.votingNone,
          holding.otherManager,
          JSON.stringify(holding.raw),
        ],
      );
    }

    for (const [cusip, priority] of [...cusipPriorities.entries()].sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      await client.query(
        `
          INSERT INTO resolution_queue (cusip, priority_value_usd)
          VALUES ($1, $2)
          ON CONFLICT (cusip) DO UPDATE SET
            priority_value_usd = greatest(resolution_queue.priority_value_usd, EXCLUDED.priority_value_usd),
            updated_at = now()
          WHERE resolution_queue.status <> 'RESOLVED'
        `,
        [cusip, priority],
      );
    }
    await client.query("COMMIT");
    return { rows: holdings.length, period: cover.periodOfReport };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function storeOwnership(
  pool: pg.Pool,
  entry: SecIndexEntry,
  documents: ArchivedDocument[],
  rawObjectKey: string,
  sourceUrl: string,
) {
  const primaryDocument = documents.find((document) =>
    /<\s*(?:\w+:)?ownershipDocument[\s>]/i.test(document.text),
  );
  if (!primaryDocument) {
    throw new Error(`${entry.formType} ${entry.accessionNumber} is missing ownership XML`);
  }
  const form = parseForm4(primaryDocument.text);
  const period = form.transactions
    .map((transaction) => transaction.transactionDate)
    .sort()
    .at(-1) ?? entry.filedDate;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertEntity(client, entry.cik, entry.companyName, "FILER");
    await upsertEntity(client, form.issuerCik, form.issuerName, "ISSUER");
    if (form.ownerCik) {
      await upsertEntity(client, form.ownerCik, form.ownerName, "INSIDER");
    }
    await client.query(
      `
        INSERT INTO filings (
          accession_number, filer_cik, form_type, filed_at, period_of_report,
          primary_document, is_amendment, raw_object_key, source_url, metadata
        )
        VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10)
      `,
      [
        entry.accessionNumber,
        entry.cik,
        entry.formType,
        entry.filedDate,
        period,
        primaryDocument.filename,
        entry.formType.endsWith("/A"),
        rawObjectKey,
        sourceUrl,
        JSON.stringify({ issuer_trading_symbol: form.issuerTradingSymbol }),
      ],
    );
    await insertDocuments(client, entry.accessionNumber, documents);
    const role = [
      form.isDirector ? "Director" : undefined,
      form.isOfficer ? form.officerTitle ?? "Officer" : undefined,
      form.isTenPercentOwner ? "10% Owner" : undefined,
    ].filter(Boolean).join(", ");

    for (const transaction of form.transactions) {
      await client.query(
        `
          INSERT INTO insider_transactions (
            accession_number, transaction_index, issuer_cik, insider_cik,
            insider_name, role, is_director, is_officer, is_ten_percent_owner,
            officer_title, transaction_date, transaction_code, shares, price,
            value_usd, acquired_disposed, ownership_after, ownership_nature,
            is_open_market, is_10b5_1, security_title, footnotes, as_filed_value
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12,
            $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
          )
        `,
        [
          entry.accessionNumber,
          transaction.index,
          form.issuerCik,
          form.ownerCik,
          form.ownerName,
          role || undefined,
          form.isDirector,
          form.isOfficer,
          form.isTenPercentOwner,
          form.officerTitle,
          transaction.transactionDate,
          transaction.transactionCode,
          transaction.shares,
          transaction.price,
          transaction.valueUsd,
          transaction.acquiredDisposed,
          transaction.ownershipAfter,
          transaction.ownershipNature,
          transaction.isOpenMarket,
          transaction.is10b51,
          transaction.securityTitle,
          JSON.stringify(transaction.footnotes),
          JSON.stringify(transaction.raw),
        ],
      );
    }
    await client.query("COMMIT");
    return { rows: form.transactions.length, period };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertEntity(
  client: pg.PoolClient,
  cik: string,
  name: string,
  entityType: string,
) {
  await client.query(
    `
      INSERT INTO entities (cik, name, entity_type)
      VALUES ($1, $2, $3)
      ON CONFLICT (cik) DO UPDATE SET
        name = CASE WHEN length(EXCLUDED.name) > 0 THEN EXCLUDED.name ELSE entities.name END,
        entity_type = CASE
          WHEN entities.entity_type = 'UNKNOWN' THEN EXCLUDED.entity_type
          ELSE entities.entity_type
        END,
        last_seen = now()
    `,
    [cik, name, entityType],
  );
}

async function insertDocuments(
  client: pg.PoolClient,
  accessionNumber: string,
  documents: ArchivedDocument[],
) {
  for (const document of documents) {
    await client.query(
      `
        INSERT INTO filing_documents (
          accession_number, sequence, filename, document_type, object_key,
          content_type, byte_size, sha256
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        accessionNumber,
        document.sequence,
        document.filename,
        document.documentType,
        document.objectKey,
        document.contentType,
        document.byteSize,
        document.sha256,
      ],
    );
  }
}
