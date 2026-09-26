/** Local cache for AI analysis results, keyed by file content hash.
 *
 * If the same file is uploaded again (syllabus or question paper), the
 * previous AI result is reused from localStorage — no PDF→images→S3→AI run.
 */

export type CacheKind = "syllabus" | "question-paper";

type CacheRecord<T> = {
  name: string;
  size: number;
  hash: string;
  savedAt: string;
  result: T;
};

const MAX_ENTRIES = 20;

function keyFor(kind: CacheKind, hash: string) {
  return `mponline_cache_${kind}_${hash}`;
}

function indexKey(kind: CacheKind) {
  return `mponline_cache_${kind}_index`;
}

function loadIndex(kind: CacheKind): string[] {
  try {
    const raw = localStorage.getItem(indexKey(kind));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function saveIndex(kind: CacheKind, hashes: string[]) {
  try {
    localStorage.setItem(indexKey(kind), JSON.stringify(hashes));
  } catch {
    // ignore
  }
}

/** SHA-256 of the file bytes (hex). Falls back to name/size stamp. */
export async function hashFile(file: File): Promise<string> {
  try {
    const buf = await file.arrayBuffer();
    if (crypto?.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", buf);
      return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
    // non-secure context fallback: cheap string hash
    const bytes = new Uint8Array(buf);
    let h1 = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i += 4097) {
      h1 ^= bytes[i];
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
    return `fb_${h1.toString(16)}_${file.size}`;
  } catch {
    return `meta_${file.name}_${file.size}_${file.lastModified}`;
  }
}

export function getCached<T>(
  kind: CacheKind,
  hash: string,
  fileName: string,
): CacheRecord<T> | null {
  try {
    const raw = localStorage.getItem(keyFor(kind, hash));
    if (!raw) return null;
    const record = JSON.parse(raw) as CacheRecord<T>;
    // a renamed file counts as a different file — re-analyse it
    if (record.name !== fileName) return null;
    return record;
  } catch {
    return null;
  }
}

export function setCached<T>(kind: CacheKind, file: File, hash: string, result: T) {
  const record: CacheRecord<T> = {
    name: file.name,
    size: file.size,
    hash,
    savedAt: new Date().toISOString(),
    result,
  };
  try {
    localStorage.setItem(keyFor(kind, hash), JSON.stringify(record));
  } catch {
    // quota full — evict oldest entries of this kind and retry once
    const index = loadIndex(kind);
    for (const old of index) {
      try {
        localStorage.removeItem(keyFor(kind, old));
      } catch {
        // ignore
      }
    }
    saveIndex(kind, []);
    try {
      localStorage.setItem(keyFor(kind, hash), JSON.stringify(record));
    } catch {
      return; // still full — skip caching
    }
  }
  const index = loadIndex(kind).filter((h) => h !== hash);
  index.unshift(hash);
  while (index.length > MAX_ENTRIES) {
    const dropped = index.pop();
    if (dropped) {
      try {
        localStorage.removeItem(keyFor(kind, dropped));
      } catch {
        // ignore
      }
    }
  }
  saveIndex(kind, index);
}
