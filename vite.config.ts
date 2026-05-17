import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    exclude: ['**/node_modules/**', 'tests/**', 'src-tauri/**'],
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and production
  clearScreen: false,

  server: {
    port: 5173,
    strictPort: false,
    // 修复 EACCES: permission denied ::1:1420s
    // 原因：Vite 默认绑定 ::1（IPv6 回环），Windows 系统策略可能禁止
    // 修复：显式绑定 127.0.0.1（IPv4 回环），Windows 始终允许
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
