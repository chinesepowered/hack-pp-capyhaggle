/**
 * One small JSON document store. Keys look like "deals/dl_abc123".
 *
 * - Development: files under .data/ (one file per key).
 * - Vercel: Vercel Blob when BLOB_READ_WRITE_TOKEN is set (one blob per key).
 *
 * PayPal stays the source of truth for money. We store PayPal ids here and re-read their status.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  /** Atomic create-if-absent. Returns false when the key already exists. */
  claim<T>(key: string, value: T): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Keys that start with the prefix, without any file extension. */
  list(prefix: string): Promise<string[]>;
}

function assertKey(key: string): void {
  if (!/^[a-z0-9][a-z0-9_\-/.]*$/i.test(key) || key.includes("..")) throw new Error(`Bad store key: ${key}`);
}

/* ------------------------------------------------------------------ files */

// On Vercel without a Blob store the only writable place is /tmp (per instance, not durable):
// enough to click through the demo, but set BLOB_READ_WRITE_TOKEN for real persistence.
const DATA_DIR = process.env.CVC_DATA_DIR ?? (process.env.VERCEL ? "/tmp/capy-data" : path.join(process.cwd(), ".data"));

function fileFor(key: string): string {
  assertKey(key);
  return path.join(DATA_DIR, `${key}.json`);
}

const fileStore: Store = {
  async get<T>(key: string) {
    try {
      return JSON.parse(await fs.readFile(fileFor(key), "utf8")) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  async set<T>(key: string, value: T) {
    const file = fileFor(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(tmp, file);
  },
  async claim<T>(key: string, value: T) {
    const file = fileFor(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      const handle = await fs.open(file, "wx");
      await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
      await handle.close();
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
  },
  async delete(key: string) {
    await fs.rm(fileFor(key), { force: true });
  },
  async list(prefix: string) {
    const out: string[] = [];
    async function walk(current: string, rel: string) {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      for (const entry of entries) {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(current, entry.name), relPath);
        else if (entry.name.endsWith(".json")) out.push(relPath.slice(0, -5));
      }
    }
    // The dev store is tiny, so walking it all and filtering is simplest and always correct.
    await walk(DATA_DIR, "");
    return out.filter((k) => k.startsWith(prefix)).sort();
  },
};

/* ------------------------------------------------------------ Vercel Blob */

const BLOB_PREFIX = "capy/";

function blobAccess(): "public" | "private" {
  return process.env.BLOB_ACCESS === "public" ? "public" : "private";
}

function blobStore(): Store {
  const pathFor = (key: string) => {
    assertKey(key);
    return `${BLOB_PREFIX}${key}.json`;
  };
  const load = () => import("@vercel/blob");
  return {
    async get<T>(key: string) {
      const { get } = await load();
      // useCache: false reads from origin storage, so a write is visible to the very next read.
      const res = await get(pathFor(key), { access: blobAccess(), useCache: false });
      if (!res || res.statusCode !== 200) return null;
      const text = await new Response(res.stream).text();
      return JSON.parse(text) as T;
    },
    async set<T>(key: string, value: T) {
      const { put } = await load();
      await put(pathFor(key), JSON.stringify(value), {
        access: blobAccess(),
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
    },
    async claim<T>(key: string, value: T) {
      const { put, BlobError } = await load();
      try {
        await put(pathFor(key), JSON.stringify(value), {
          access: blobAccess(),
          allowOverwrite: false,
          addRandomSuffix: false,
          contentType: "application/json",
          cacheControlMaxAge: 60,
        });
        return true;
      } catch (err) {
        if (err instanceof BlobError && /already exists/i.test(err.message)) return false;
        throw err;
      }
    },
    async delete(key: string) {
      const { del } = await load();
      await del(pathFor(key));
    },
    async list(prefix: string) {
      const { list } = await load();
      const out: string[] = [];
      let cursor: string | undefined;
      // Bounded loop: a demo store never holds more than a few hundred documents.
      for (let page = 0; page < 20; page++) {
        const res = await list({ prefix: `${BLOB_PREFIX}${prefix}`, cursor, limit: 1000 });
        for (const blob of res.blobs) {
          if (blob.pathname.endsWith(".json")) out.push(blob.pathname.slice(BLOB_PREFIX.length, -5));
        }
        if (!res.hasMore || !res.cursor) break;
        cursor = res.cursor;
      }
      return out.sort();
    },
  };
}

/* ----------------------------------------------------------------- export */

let memo: Store | undefined;

export function store(): Store {
  if (!memo) memo = process.env.BLOB_READ_WRITE_TOKEN ? blobStore() : fileStore;
  return memo;
}

export function storeKind(): "vercel-blob" | "files" {
  return process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "files";
}

/** Test hook: swap in an in-memory store. */
export function setStoreForTests(s: Store | undefined): void {
  memo = s;
}

export function memoryStore(): Store {
  const map = new Map<string, string>();
  return {
    async get<T>(key: string) {
      const v = map.get(key);
      return v === undefined ? null : (JSON.parse(v) as T);
    },
    async set<T>(key: string, value: T) {
      map.set(key, JSON.stringify(value));
    },
    async claim<T>(key: string, value: T) {
      if (map.has(key)) return false;
      map.set(key, JSON.stringify(value));
      return true;
    },
    async delete(key: string) {
      map.delete(key);
    },
    async list(prefix: string) {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}
