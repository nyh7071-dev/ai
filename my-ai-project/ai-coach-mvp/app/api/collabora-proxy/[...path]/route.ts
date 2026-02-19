import { NextRequest, NextResponse } from "next/server";

// Collabora를 Next.js를 통해 프록시 (Mixed Content 문제 해결)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> | { path: string[] } }
) {
  try {
    // Handle both Promise and direct params (Next.js 13+ compatibility)
    const resolvedParams = await Promise.resolve(params);
    const pathSegments = resolvedParams?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join("/") : "";

    const collaboraUrl = `http://localhost:9980/${path}`;
    const searchParams = req.nextUrl.searchParams.toString();
    const fullUrl = searchParams ? `${collaboraUrl}?${searchParams}` : collaboraUrl;

    console.log("Proxying GET to Collabora:", fullUrl);

    const response = await fetch(fullUrl, {
      method: "GET",
      headers: {
        "User-Agent": req.headers.get("user-agent") || "",
      },
    });

    const contentType = response.headers.get("content-type") || "application/octet-stream";

    // HTML, CSS, JS 등은 텍스트로, 나머지는 바이너리로
    if (contentType.includes("text") || contentType.includes("javascript") || contentType.includes("json") || contentType.includes("html")) {
      const text = await response.text();
      return new NextResponse(text, {
        status: response.status,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
        },
      });
    } else {
      const data = await response.arrayBuffer();
      return new NextResponse(data, {
        status: response.status,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

  } catch (err: any) {
    console.error("Collabora proxy GET error:", err);
    return NextResponse.json(
      { error: err.message || "프록시 에러" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> | { path: string[] } }
) {
  try {
    // Handle both Promise and direct params (Next.js 13+ compatibility)
    const resolvedParams = await Promise.resolve(params);
    const pathSegments = resolvedParams?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join("/") : "";

    const collaboraUrl = `http://localhost:9980/${path}`;
    const searchParams = req.nextUrl.searchParams.toString();
    const fullUrl = searchParams ? `${collaboraUrl}?${searchParams}` : collaboraUrl;

    console.log("Proxying POST to Collabora:", fullUrl);

    const body = await req.arrayBuffer();

    const response = await fetch(fullUrl, {
      method: "POST",
      headers: {
        "Content-Type": req.headers.get("content-type") || "application/json",
        "User-Agent": req.headers.get("user-agent") || "",
      },
      body,
    });

    const data = await response.arrayBuffer();

    return new NextResponse(data, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch (err: any) {
    console.error("Collabora proxy POST error:", err);
    return NextResponse.json(
      { error: err.message || "프록시 에러" },
      { status: 500 }
    );
  }
}
