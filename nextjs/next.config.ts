import type { NextConfig } from "next";

const DAILIES_API = "https://6myvclfrgz5y3h6qtkc7oijiru0objgl.lambda-url.us-east-1.on.aws";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/dailies/join/:code", destination: `${DAILIES_API}/dailies/join/:code` },
      { source: "/dailies/privacy", destination: `${DAILIES_API}/privacy` },
      { source: "/dailies/support", destination: `${DAILIES_API}/support` },
    ];
  },
};

export default nextConfig;
