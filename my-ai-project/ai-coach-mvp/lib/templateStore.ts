import { openDB, type DBSchema } from "idb";

type TemplateRecord = {
  id: string;
  name: string;
  buffer: ArrayBuffer;
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

const dbPromise = openDB<TemplateDB>(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: "id" });
    }
  },
});

function makeId() {
  // 브라우저 호환 (crypto.randomUUID 없을 때 대비)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function saveTemplateToIDB(name: string, buffer: ArrayBuffer) {
  const db = await dbPromise;
  const id = makeId();
  await db.put(STORE, { id, name, buffer, createdAt: Date.now() });
  return id;
}

export async function getTemplateFromIDB(id: string) {
  const db = await dbPromise;
  return db.get(STORE, id);
}
