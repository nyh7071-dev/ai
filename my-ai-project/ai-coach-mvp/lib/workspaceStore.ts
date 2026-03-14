import { openDB, type DBSchema } from "idb";
import { supabase } from "@/lib/supabase";

export interface WorkspaceRecord {
  id: string;
  name: string;
  type: string;
  templateId: string;
  templateFileId?: string;
  filledFileId?: string;
  filledBuffer?: ArrayBuffer;
  slots: Array<{
    key: string;
    kind: string;
    label: string;
    currentText: string;
    xmlPath: string;
    structural?: boolean;
  }>;
  lastResults: Array<{ key: string; value: string }>;
  sourceTexts: Array<{ name: string; text: string }>;
  messages: Array<{ role: "ai" | "user"; text: string }>;
  updatedAt: number;
  createdAt: number;
}

type WorkspacePayload = Omit<WorkspaceRecord, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

type RemoteWorkspaceRow = {
  id: string;
  owner_user_id: string;
  name: string;
  type: string;
  template_file_id: string | null;
  filled_file_id: string | null;
  slots: WorkspaceRecord["slots"];
  last_results: WorkspaceRecord["lastResults"];
  source_texts: WorkspaceRecord["sourceTexts"];
  messages: WorkspaceRecord["messages"];
  created_at: string;
  updated_at: string;
};

interface WorkspaceDB extends DBSchema {
  workspaces: {
    key: string;
    value: WorkspaceRecord;
    indexes: { "by-updated": number };
  };
}

const DB_NAME = "repot-workspaces";
const STORE = "workspaces";

let dbPromise: ReturnType<typeof openDB<WorkspaceDB>> | null = null;

function getDb() {
  if (dbPromise) return dbPromise;
  if (typeof window === "undefined" || !("indexedDB" in globalThis)) {
    throw new Error("IndexedDB is not available in this environment.");
  }
  dbPromise = openDB<WorkspaceDB>(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("by-updated", "updatedAt");
      }
    },
  });
  return dbPromise;
}

function makeId() {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeWorkspace(record: WorkspaceRecord): WorkspaceRecord {
  return {
    ...record,
    templateFileId: record.templateFileId || "",
    filledFileId: record.filledFileId || "",
    slots: record.slots || [],
    lastResults: record.lastResults || [],
    sourceTexts: record.sourceTexts || [],
    messages: record.messages || [],
  };
}

function toRemoteRow(
  ownerUserId: string,
  record: WorkspaceRecord
): Omit<RemoteWorkspaceRow, "created_at" | "updated_at"> {
  return {
    id: record.id,
    owner_user_id: ownerUserId,
    name: record.name,
    type: record.type,
    template_file_id: record.templateFileId || null,
    filled_file_id: record.filledFileId || null,
    slots: record.slots,
    last_results: record.lastResults,
    source_texts: record.sourceTexts,
    messages: record.messages,
  };
}

function fromRemoteRow(row: RemoteWorkspaceRow): WorkspaceRecord {
  return normalizeWorkspace({
    id: row.id,
    name: row.name,
    type: row.type,
    templateId: "",
    templateFileId: row.template_file_id || "",
    filledFileId: row.filled_file_id || "",
    slots: row.slots || [],
    lastResults: row.last_results || [],
    sourceTexts: row.source_texts || [],
    messages: row.messages || [],
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  });
}

async function getCurrentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id || null;
}

async function syncWorkspaceToCloud(record: WorkspaceRecord) {
  try {
    const ownerUserId = await getCurrentUserId();
    if (!ownerUserId) return;

    const payload = toRemoteRow(ownerUserId, record);
    const { error } = await supabase.from("workspaces").upsert(payload);
    if (error) {
      console.warn("workspace cloud sync failed:", error.message);
    }
  } catch (error) {
    console.warn("workspace cloud sync failed:", error);
  }
}

async function fetchWorkspaceFromCloud(id: string) {
  try {
    const ownerUserId = await getCurrentUserId();
    if (!ownerUserId) return undefined;

    const { data, error } = await supabase
      .from("workspaces")
      .select("*")
      .eq("id", id)
      .eq("owner_user_id", ownerUserId)
      .single<RemoteWorkspaceRow>();

    if (error || !data) return undefined;
    return fromRemoteRow(data);
  } catch (error) {
    console.warn("workspace cloud fetch failed:", error);
    return undefined;
  }
}

async function listWorkspacesFromCloud(limit: number) {
  try {
    const ownerUserId = await getCurrentUserId();
    if (!ownerUserId) return [];

    const { data, error } = await supabase
      .from("workspaces")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .order("updated_at", { ascending: false })
      .limit(limit)
      .returns<RemoteWorkspaceRow[]>();

    if (error || !data) return [];
    return data.map(fromRemoteRow);
  } catch (error) {
    console.warn("workspace cloud list failed:", error);
    return [];
  }
}

async function deleteWorkspaceFromCloud(id: string) {
  try {
    const ownerUserId = await getCurrentUserId();
    if (!ownerUserId) return;

    const { error } = await supabase
      .from("workspaces")
      .delete()
      .eq("id", id)
      .eq("owner_user_id", ownerUserId);

    if (error) {
      console.warn("workspace cloud delete failed:", error.message);
    }
  } catch (error) {
    console.warn("workspace cloud delete failed:", error);
  }
}

export async function saveWorkspace(data: WorkspacePayload): Promise<string> {
  const db = await getDb();
  const now = Date.now();

  let record: WorkspaceRecord;
  if (data.id) {
    const existing = await db.get(STORE, data.id);
    if (existing) {
      record = normalizeWorkspace({
        ...existing,
        ...data,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      });
    } else {
      record = normalizeWorkspace({
        ...data,
        id: data.id,
        createdAt: now,
        updatedAt: now,
      } as WorkspaceRecord);
    }
  } else {
    record = normalizeWorkspace({
      ...data,
      id: makeId(),
      createdAt: now,
      updatedAt: now,
    } as WorkspaceRecord);
  }

  await db.put(STORE, record);
  void syncWorkspaceToCloud(record);
  return record.id;
}

export async function getWorkspace(id: string): Promise<WorkspaceRecord | undefined> {
  const db = await getDb();
  const local = await db.get(STORE, id);
  if (local) return normalizeWorkspace(local);

  const remote = await fetchWorkspaceFromCloud(id);
  if (remote) {
    await db.put(STORE, remote);
    return remote;
  }

  return undefined;
}

export async function listWorkspaces(limit = 20): Promise<WorkspaceRecord[]> {
  const db = await getDb();
  const local = (await db.getAllFromIndex(STORE, "by-updated")).reverse();
  const remote = await listWorkspacesFromCloud(limit);

  const merged = new Map<string, WorkspaceRecord>();
  for (const item of remote) {
    merged.set(item.id, item);
    await db.put(STORE, item);
  }
  for (const item of local) {
    if (!merged.has(item.id)) merged.set(item.id, normalizeWorkspace(item));
  }

  return Array.from(merged.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

export async function deleteWorkspace(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
  void deleteWorkspaceFromCloud(id);
}
