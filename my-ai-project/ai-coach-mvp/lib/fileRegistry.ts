"use client";

import { supabase } from "@/lib/supabase";

type RegisterUploadedFileInput = {
  fileId: string;
  fileName: string;
  storageKey: string;
  contentType: string;
  byteSize: number;
};

export async function registerUploadedFile(input: RegisterUploadedFileInput) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { error } = await supabase.from("files").upsert({
      id: input.fileId,
      owner_user_id: user.id,
      storage_key: input.storageKey,
      original_name: input.fileName,
      content_type: input.contentType,
      byte_size: input.byteSize,
    });

    if (error) {
      console.warn("file registry sync failed:", error.message);
    }
  } catch (error) {
    console.warn("file registry sync failed:", error);
  }
}
