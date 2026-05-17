// src/__tests__/setup.ts
import '@testing-library/jest-dom'
// Mock Tauri IPC — 测试环境中无 Tauri 运行时
vi.mock('@/services/tauriIpc', () => ({
  api: {
    photos: {
      list: vi.fn().mockResolvedValue({ items: [], nextCursor: null, total: 0 }),
    },
  },
  ipc: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))