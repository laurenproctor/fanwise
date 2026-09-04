import type { NextConfig } from "next"

const config: NextConfig = {
  reactStrictMode: true,
  // sharp ships prebuilt native binaries. Bundling it breaks the binding
  // resolution, so it stays external to the server build.
  serverExternalPackages: ["sharp"],
}

export default config
