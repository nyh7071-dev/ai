import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

const UPLOAD_DIR =
  process.env.VERCEL || process.env.NODE_ENV === "production"
    ? join(tmpdir(), "repot-ai", "uploads")
    : join(process.cwd(), ".data", "uploads");

function sanitizeId(value: string) {
  return basename(value);
}

function getExtension(fileName: string) {
  const safeName = basename(fileName);
  const ext = safeName.split(".").pop();
  return ext && ext !== safeName ? ext.toLowerCase() : "";
}

function buildFileName(fileId: string, extension: string) {
  return extension ? `${fileId}.${extension}` : fileId;
}

async function ensureUploadDir() {
  await mkdir(UPLOAD_DIR, { recursive: true });
  return UPLOAD_DIR;
}

async function mirrorToSupabaseStorage(fileName: string, buffer: Buffer) {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { error } = await admin.client.storage
    .from(admin.bucket)
    .upload(fileName, buffer, {
      upsert: true,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

  if (error) {
    console.warn("supabase storage upload failed:", error.message);
    return null;
  }

  return fileName;
}

export async function saveUploadedFile(buffer: Buffer, originalName: string, fileId?: string) {
  const safeId = sanitizeId(fileId ?? randomUUID());
  const extension = getExtension(originalName);
  const fileName = buildFileName(safeId, extension);
  const uploadDir = await ensureUploadDir();

  await writeFile(join(uploadDir, fileName), buffer);
  const storageKey = await mirrorToSupabaseStorage(fileName, buffer);

  return {
    fileId: safeId,
    fileName,
    storageKey: storageKey || safeId,
  };
}

async function readFromSupabaseStorage(fileId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data: row, error: rowError } = await admin.client
    .from("files")
    .select("storage_key, original_name")
    .eq("id", fileId)
    .single<{ storage_key: string; original_name: string }>();

  if (!rowError && row?.storage_key && row.storage_key !== fileId) {
    const { data, error } = await admin.client.storage.from(admin.bucket).download(row.storage_key);
    if (error || !data) {
      console.warn("supabase storage download failed:", error?.message);
      return null;
    }

    return {
      fileId,
      fileName: row.original_name || row.storage_key,
      buffer: Buffer.from(await data.arrayBuffer()),
    };
  }

  const { data: candidates, error: listError } = await admin.client.storage.from(admin.bucket).list("", {
    search: fileId,
  });

  if (listError || !candidates?.length) {
    if (listError) {
      console.warn("supabase storage list failed:", listError.message);
    }
    return null;
  }

  const match = candidates.find((entry) => entry.name === fileId || entry.name.startsWith(`${fileId}.`));
  if (!match?.name) return null;

  const { data, error } = await admin.client.storage.from(admin.bucket).download(match.name);
  if (error || !data) {
    console.warn("supabase storage download failed:", error?.message);
    return null;
  }

  return {
    fileId,
    fileName: match.name,
    buffer: Buffer.from(await data.arrayBuffer()),
  };
}

export async function readUploadedFile(fileId: string) {
  const safeId = sanitizeId(fileId);
  const remoteFile = await readFromSupabaseStorage(safeId);
  if (remoteFile) return remoteFile;

  const uploadDir = await ensureUploadDir();
  const files = await readdir(uploadDir);
  const match = files.find((file) => file === safeId || file.startsWith(`${safeId}.`));

  if (!match) return null;

  return {
    fileId: safeId,
    fileName: match,
    buffer: await readFile(join(uploadDir, match)),
  };
}
