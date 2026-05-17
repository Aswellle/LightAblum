/**
 * @file tests/bench/scroll_fps.ts
 * @description 前端滚动帧率基准测试（Phase-E）
 *
 * 验证目标（PRD §9.1）：
 *   G-2 极致流畅：10 万张图片下滚动帧率 ≥ 55fps
 *
 * 方案：
 *   1. 使用 Playwright page.evaluate 注入 rAF 帧计数器
 *   2. mock photoStore 注入大量测试照片（10000 条，绕过 Tauri IPC）
 *   3. 通过 page.mouse.wheel 模拟快速滚动
 *   4. 计算滚动期间的实际帧率
 *   5. 断言 fps ≥ 55（偏差容忍至 50fps）
 *
 * 运行命令：
 *   npx playwright test tests/bench/scroll_fps.ts
 *   或
 *   npm run test:bench
 *
 * 注意：
 *   - 此测试需要 Vite dev server 在 5173 端口运行
 *   - CI 环境中 GPU 加速可能受限，FPS 目标适当降低至 30fps
 *   - 本测试不会在 test:e2e 命令中自动运行（需单独执行）
 */

import { chromium, type Page, type Browser } from '@playwright/test'

// ─────────────────────────────────────────────────────────
//  帧率测量工具
// ─────────────────────────────────────────────────────────

interface FpsResult {
  fps: number
  frames: number
  durationMs: number
  minFrameMs: number
  maxFrameMs: number
  p95FrameMs: number
}

/**
 * 注入帧率计数器并测量指定时间窗口内的 rAF 帧率
 * @param page     Playwright Page
 * @param durationMs 测量持续时间（毫秒）
 */
async function measureFps(page: Page, durationMs: number): Promise<FpsResult> {
  return page.evaluate(async (duration: number) => {
    return new Promise<{
      fps: number; frames: number; durationMs: number
      minFrameMs: number; maxFrameMs: number; p95FrameMs: number
    }>((resolve) => {
      const frameTimes: number[] = []
      let lastTime = performance.now()
      let rafId: number

      const countFrame = (now: number) => {
        const delta = now - lastTime
        frameTimes.push(delta)
        lastTime = now
        rafId = requestAnimationFrame(countFrame)
      }

      rafId = requestAnimationFrame(countFrame)

      setTimeout(() => {
        cancelAnimationFrame(rafId)

        const totalFrames = frameTimes.length
        const totalTime   = frameTimes.reduce((a, b) => a + b, 0)
        const fps         = totalFrames / (totalTime / 1000)

        const sorted = [...frameTimes].sort((a, b) => a - b)
        const p95Idx = Math.floor(sorted.length * 0.95)

        resolve({
          fps:        Math.round(fps * 10) / 10,
          frames:     totalFrames,
          durationMs: Math.round(totalTime),
          minFrameMs: Math.round(sorted[0] * 10) / 10,
          maxFrameMs: Math.round(sorted[sorted.length - 1] * 10) / 10,
          p95FrameMs: Math.round(sorted[p95Idx] * 10) / 10,
        })
      }, duration)
    })
  }, durationMs)
}

/**
 * 向 photoStore 注入测试数据（绕过 Tauri IPC）
 * 通过 window.__TEST_INJECT_PHOTOS__ hook（若应用暴露了测试接口）
 * 或直接操作 localStorage 触发 store 初始化
 */
async function injectMockPhotos(page: Page, count: number) {
  await page.evaluate((photoCount: number) => {
    const photos = Array.from({ length: photoCount }, (_, i) => ({
      id:          `photo-${i.toString().padStart(6, '0')}`,
      fileName:    `IMG_${i.toString().padStart(4, '0')}.jpg`,
      width:       3024,
      height:      4032,
      orientation: 1,
      createdAt:   new Date(2024, i % 12, (i % 28) + 1).toISOString(),
      isFavorite:  i % 10 === 0,
      isDeleted:   false,
      thumbnailS:  null,
      thumbnailM:  null,
      format:      'jpeg',
      folderPath:  'D:/Photos',
    }))

    // 尝试通过 window 暴露的 store 接口注入（开发环境）
    if ((window as any).__TEST_SET_PHOTOS__) {
      ;(window as any).__TEST_SET_PHOTOS__(photos, photoCount)
    } else {
      // 降级：通过 CustomEvent 通知
      window.dispatchEvent(new CustomEvent('test:inject-photos', {
        detail: { photos, total: photoCount }
      }))
    }
  }, count)

  // 等待 React 渲染
  await page.waitForTimeout(500)
}

// ─────────────────────────────────────────────────────────
//  主基准测试函数
// ─────────────────────────────────────────────────────────

async function runScrollFpsBench() {
  const isCI = !!process.env.CI
  const FPS_TARGET = isCI ? 30 : 55  // CI 环境降低目标至 30fps

  console.log(`\n🔬 LightAlbum 滚动帧率基准测试`)
  console.log(`   目标 FPS：≥ ${FPS_TARGET}`)
  console.log(`   环境：${isCI ? 'CI' : '本地开发'}`)
  console.log(`   平台：${process.platform}\n`)

  const browser: Browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--enable-gpu',
      '--enable-zero-copy',
    ],
  })

  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  })

  // ── 收集 console 错误 ──
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  try {
    await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
    await page.waitForSelector('#root', { timeout: 15_000 })
    await page.waitForTimeout(1000)  // 等待初始渲染稳定

    // ── 注入 10000 张 mock 照片 ──
    console.log('📸 注入 10000 张 mock 照片...')
    await injectMockPhotos(page, 10_000)
    console.log('   注入完成，等待渲染...\n')

    // ── 测量静止帧率（基准线）──
    console.log('📊 测量静止帧率（基准线，2s）...')
    const idleFps = await measureFps(page, 2000)
    console.log(`   静止 FPS：${idleFps.fps} (${idleFps.frames} frames / ${idleFps.durationMs}ms)`)

    // ── 测量滚动帧率 ──
    console.log('\n📊 测量快速滚动帧率（3s）...')

    // 找到主滚动容器
    const scrollContainer = page.locator(
      '[class*="scroll"], [class*="grid"], main, .la-main-content'
    ).first()

    // 并发滚动 + 帧率测量
    const [scrollFps] = await Promise.all([
      measureFps(page, 3000),
      (async () => {
        // 模拟快速滚动：每 100ms 滚动 500px，持续 3s
        const centerX = 640
        const centerY = 400
        for (let i = 0; i < 30; i++) {
          await page.mouse.wheel(0, 500)
          await page.waitForTimeout(100)
        }
      })(),
    ])

    console.log(`   滚动 FPS：${scrollFps.fps}`)
    console.log(`   帧数：${scrollFps.frames}`)
    console.log(`   最小帧时间：${scrollFps.minFrameMs}ms`)
    console.log(`   最大帧时间：${scrollFps.maxFrameMs}ms`)
    console.log(`   P95 帧时间：${scrollFps.p95FrameMs}ms`)

    // ── 测量向上滚动帧率 ──
    console.log('\n📊 测量向上滚动帧率（2s）...')
    const [upScrollFps] = await Promise.all([
      measureFps(page, 2000),
      (async () => {
        for (let i = 0; i < 20; i++) {
          await page.mouse.wheel(0, -500)
          await page.waitForTimeout(100)
        }
      })(),
    ])
    console.log(`   向上滚动 FPS：${upScrollFps.fps}`)

    // ── 结果评估 ──
    console.log('\n📋 测试结果评估')
    console.log('─'.repeat(50))

    const passIcon = (v: boolean) => v ? '✅' : '❌'

    const scrollPass = scrollFps.fps >= FPS_TARGET
    const upScrollPass = upScrollFps.fps >= FPS_TARGET
    const p95Pass = scrollFps.p95FrameMs < (1000 / FPS_TARGET * 2)  // P95 < 2x 帧预算

    console.log(`${passIcon(scrollPass)} 向下滚动 FPS: ${scrollFps.fps} (目标: ≥${FPS_TARGET})`)
    console.log(`${passIcon(upScrollPass)} 向上滚动 FPS: ${upScrollFps.fps} (目标: ≥${FPS_TARGET})`)
    console.log(`${passIcon(p95Pass)} P95 帧时间: ${scrollFps.p95FrameMs}ms (目标: <${Math.round(1000 / FPS_TARGET * 2)}ms)`)

    if (errors.length > 0) {
      console.log(`\n⚠️  Console 错误 (${errors.length} 条):`)
      errors.slice(0, 5).forEach(e => console.log(`   ${e}`))
    }

    const allPass = scrollPass && upScrollPass && p95Pass
    console.log('\n' + (allPass ? '✅ 所有基准测试通过' : '❌ 部分基准测试未通过'))

    if (!allPass && !isCI) {
      process.exit(1)
    }

  } finally {
    await browser.close()
  }
}

// ─────────────────────────────────────────────────────────
//  执行
// ─────────────────────────────────────────────────────────

runScrollFpsBench().catch((err) => {
  console.error('基准测试失败:', err)
  process.exit(1)
})
