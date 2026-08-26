import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.joker.mobile",
  appName: "Joker",
  webDir: "dist",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false }
};

export default config;
