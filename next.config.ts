import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The Daytona SDK reaches for `form-data` via a dynamic require when
   * uploading. Bundling it breaks that: the route fails at upload time with
   * `Module "form-data" is not available in the "node" runtime`. Marking the
   * SDK external leaves it on Node's own resolver, where the dynamic require
   * works.
   *
   * Worth knowing: a standalone script exercising the same SDK calls passes
   * even when the bundled route fails, because it never goes through the
   * bundler. Only the route proves the route.
   */
  serverExternalPackages: ["@daytona/sdk"],
};

export default nextConfig;
