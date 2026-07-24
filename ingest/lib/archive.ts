import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { IngestConfig } from "../config";

export interface ArchiveResult {
  key: string;
  sha256: string;
  byteSize: number;
  existed: boolean;
}

export interface RawArchive {
  putImmutable(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<ArchiveResult>;
}

export function createArchive(config: IngestConfig): RawArchive {
  if (!config.r2Configured) return new LocalArchive(".data/raw");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID!,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY!,
    },
  });
  return new R2Archive(client, config.R2_BUCKET);
}

class R2Archive implements RawArchive {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async putImmutable(key: string, body: Uint8Array, contentType: string) {
    const sha256 = digest(body);
    try {
      const existing = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const existingHash = existing.Metadata?.sha256;
      if (existingHash && existingHash !== sha256) {
        throw new Error(`Immutable archive collision for ${key}`);
      }
      return { key, sha256, byteSize: body.byteLength, existed: true };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status !== 404) throw error;
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: { sha256 },
      }),
    );
    return { key, sha256, byteSize: body.byteLength, existed: false };
  }
}

class LocalArchive implements RawArchive {
  constructor(private readonly root: string) {}

  async putImmutable(key: string, body: Uint8Array, contentType: string) {
    void contentType;
    const path = resolve(this.root, key);
    const sha256 = digest(body);
    try {
      await access(path);
      const existing = await readFile(path);
      if (digest(existing) !== sha256) {
        throw new Error(`Immutable archive collision for ${key}`);
      }
      return { key, sha256, byteSize: body.byteLength, existed: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { flag: "wx" });
    return { key, sha256, byteSize: body.byteLength, existed: false };
  }
}

function digest(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
