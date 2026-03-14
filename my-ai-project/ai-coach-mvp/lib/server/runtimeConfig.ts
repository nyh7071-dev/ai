type RuntimeConfigKey =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "SUPABASE_STORAGE_BUCKET"
  | "NEXT_PUBLIC_ONLYOFFICE_URL"
  | "FILE_PUBLIC_BASE_URL"
  | "FILE_ACCESS_TOKEN_SECRET"
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY";

function getEnvValue(key: RuntimeConfigKey) {
  const value = process.env[key];
  return typeof value === "string" ? value.trim() : "";
}

export function getRequiredEnv(key: RuntimeConfigKey) {
  const value = getEnvValue(key);
  if (value) return value;
  throw new Error(`${key} is required`);
}

export function validateProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;

  const requiredKeys: RuntimeConfigKey[] = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_ONLYOFFICE_URL",
    "FILE_PUBLIC_BASE_URL",
    "FILE_ACCESS_TOKEN_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_STORAGE_BUCKET",
    "OPENAI_API_KEY",
  ];

  for (const key of requiredKeys) {
    getRequiredEnv(key);
  }
}
