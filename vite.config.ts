import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nitro } from "nitro/vite";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      nitro(),
    ],
    server: {
      host: "0.0.0.0",
      port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
      allowedHosts: ["frustration-scraper.onrender.com"],
    },
    preview: {
      host: "0.0.0.0",
      port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
      allowedHosts: ["frustration-scraper.onrender.com"],
    },
  },
});