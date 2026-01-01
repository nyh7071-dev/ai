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
};

export default nextConfig;
