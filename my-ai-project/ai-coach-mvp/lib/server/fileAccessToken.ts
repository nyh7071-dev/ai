import { createHmac, timingSafeEqual } from "node:crypto";
import { getRequiredEnv } from "@/lib/server/runtimeConfig";

const TOKEN_TTL_SECONDS = 60 * 60;

type FileTokenPayload = {
  fileId: string;
  exp: number;
};

function getSecret() {
  const secret = process.env.FILE_ACCESS_TOKEN_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") {
    return "dev-file-access-secret-change-me";
  }
  return getRequiredEnv("FILE_ACCESS_TOKEN_SECRET");
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(encodedPayload: string) {
  return createHmac("sha256", getSecret()).update(encodedPayload).digest("base64url");
}

export function createFileAccessToken(fileId: string, expiresInSeconds = TOKEN_TTL_SECONDS) {
  const payload: FileTokenPayload = {
    fileId,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyFileAccessToken(token: string, fileId: string) {
  const [encodedPayload, receivedSignature] = token.split(".");
  if (!encodedPayload || !receivedSignature) return false;

  const expectedSignature = sign(encodedPayload);
  const receivedBuffer = Buffer.from(receivedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (receivedBuffer.length !== expectedBuffer.length) return false;
  if (!timingSafeEqual(receivedBuffer, expectedBuffer)) return false;

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as FileTokenPayload;
    const now = Math.floor(Date.now() / 1000);
    return payload.fileId === fileId && payload.exp > now;
  } catch {
    return false;
  }
}
