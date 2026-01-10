import { openDB, type DBSchema } from "idb";

type TemplateRecord = {
  id: string;
  name: string;
  buffer: ArrayBuffer;
  publicUrl?: string;
  createdAt: number;
};

interface TemplateDB extends DBSchema {
  templates: {
    key: string;
    value: TemplateRecord;
  };
}

const DB_NAME = "repot-templates";
const STORE = "templates";

let dbPromise: Promise<ReturnType<typeof openDB<TemplateDB>>> | null = null;

function getDb() {
  if (dbPromise) return dbPromise;
  if (typeof window === "undefined" || !("indexedDB" in globalThis)) {
    throw new Error("IndexedDB를 사용할 수 없는 환경입니다.");
  }
  dbPromise = openDB<TemplateDB>(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    },
  });
  return dbPromise;
}

function makeId() {
  // 브라우저 호환 (crypto.randomUUID 없을 때 대비)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function saveTemplateToIDB(name: string, buffer: ArrayBuffer, publicUrl?: string) {
  const db = await getDb();
  const id = makeId();
  await db.put(STORE, { id, name, buffer, publicUrl, createdAt: Date.now() });
  return id;
}

export async function getTemplateFromIDB(id: string) {
  const db = await getDb();
  return db.get(STORE, id);
}
