import path from "path";
import type { NextConfig } from "next";

const repoRoot = path.resolve(__dirname);
const workspaceRoot = process.env.NEXT_WORKSPACE_ROOT
  ? path.resolve(process.env.NEXT_WORKSPACE_ROOT)
  : repoRoot;

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // OnlyOffice 플러그인용 CORS 헤더
  async headers() {
    return [
      {
        source: "/onlyoffice-plugin/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
        ],
      },
    ];
  },
};

export default nextConfig;
