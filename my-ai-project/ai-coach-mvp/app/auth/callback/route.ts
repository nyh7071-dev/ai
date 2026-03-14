import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const nextUrl = new URL("/login", request.url);

  if (code) {
    nextUrl.searchParams.set("code", code);
  }

  return NextResponse.redirect(nextUrl);
}
