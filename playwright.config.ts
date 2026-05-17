/**
 * @file playwright.config.ts
 * @description Playwright E2E 测试配置（Phase-E）
 *
 * 测试策略说明：
 *   LightAlbum 是 Tauri 桌面应用，前端通过 devUrl（http://127.0.0.1:5173）
 *   在开发模式下可直接用浏览器访问 WebView2 内容。
 *
 *   E2E 测试方案：
 *     - 使用 @playwright/test 连接到开发服务器（非真正的 Tauri IPC 环境）
 *     - 测试 UI 交互、布局、动画完成性、状态切换
 *     - Tauri IPC 调用通过 page.evaluate 注入 mock 或验证 DOM 结果
 *     - 网络请求通过 page.route 拦截（模拟后端响应）
 *
 *   运行前提：
 *     npm run dev（Vite dev server 在 5173 端口运行）
 *     或 npm run build + npm run preview
 *
 * 运行命令：
 *   npm run test:e2e              # 全部 E2E 测试
 *   npm run test:e2e -- --ui     # 打开 Playwright UI
 *   npx playwright test grid     # 只运行 grid.spec.ts
 */

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  // ── 测试文件位置 ──────────────────────────────────────
  testDir: './tests/e2e',

  // ── 超时配置 ──────────────────────────────────────────
  timeout: 30_000,            // 单个测试最长 30s
  expect: {
    timeout: 5_000,           // expect 断言等待最长 5s
  },

  // ── 全局设置 ──────────────────────────────────────────
  fullyParallel: false,       // 顺序执行（避免多测试并发影响 UI 状态）
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,                 // 单 worker（桌面应用 UI 测试不适合并发）

  // ── 报告 ──────────────────────────────────────────────
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  // ── 共享配置 ──────────────────────────────────────────
  use: {
    baseURL: 'http://127.0.0.1:5173',

    // 截图：仅失败时保存
    screenshot: 'only-on-failure',

    // 视频：仅失败时保存
    video: 'retain-on-failure',

    // 追踪：仅 CI 失败时保存
    trace: 'retain-on-failure',

    // 视口：模拟 1280×800 桌面窗口（与 tauri.conf.json 一致）
    viewport: { width: 1280, height: 800 },
  },

  // ── 浏览器配置 ────────────────────────────────────────
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // 模拟 WebView2 环境（Chromium-based）
        viewport: { width: 1280, height: 800 },
      },
    },
  ],

  // ── Web 服务器（测试前自动启动 Vite dev server）────────
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,          // Vite 冷启动最长 60s
  },
})
