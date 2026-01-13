import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      lines: 100,
      functions: 100,
      branches: 100,
      statements: 100,
      include: ["src/**/*.vue", "src/**/*.js"]
    }
  }
});