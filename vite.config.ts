import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/export": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
