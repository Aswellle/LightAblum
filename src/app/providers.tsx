/**
 * @file src/app/providers.tsx
 * @description 全局 Provider 组合（完整保留原始版本）
 *
 * Provider 层级（由外到内）：
 *   QueryClientProvider     TanStack Query 缓存
 *   └─ ConfirmDialogProvider  命令式确认弹窗（useConfirmDialog hook）
 *      └─ children            App 内容
 *
 * QueryClient 配置说明：
 *   - staleTime: Infinity   本地 SQLite 数据由 eventBus 手动 reset/invalidate
 *   - gcTime: 10min         10 分钟无订阅者 GC
 *   - retry: 1              IPC 失败最多重试一次
 *   - refetchOnWindowFocus/Reconnect: false  纯离线桌面应用
 *   - refetchOnMount: true  确保组件挂载时若无缓存数据能正常拉取首屏数据
 *
 * Bugfix 说明：
 *   原来 refetchOnMount:false 导致组件挂载时完全不拉取数据。
 *   虽然"首次无缓存"时依然会 fetch（TanStack Query 默认行为），
 *   但与 staleTime:Infinity 组合后，经 resetQueries 清除缓存的 query
 *   在组件重新挂载时依赖 refetchOnMount:true 才能拿到最新数据。
 *   改为 true 保证缓存清除后重挂载能自动请求，与 eventBus 的
 *   resetQueries 配合形成完整的「扫描完成 → 缓存清除 → 重新拉取」链路。
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { ConfirmDialogProvider } from '@/components/common/ConfirmDialog'
import { TagEditorProvider } from '@/components/common/TagEditor'  // Phase-B M-12

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime:            Infinity,
        gcTime:               10 * 60 * 1000,
        retry:                1,
        refetchOnWindowFocus: false,
        refetchOnReconnect:   false,
        // Bugfix: 改为 true，确保 resetQueries 后组件重新挂载时能拉到最新数据
        refetchOnMount:       true,
      },
      mutations: {
        retry: 0,
      },
    },
  })
}

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(() => makeQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider>
        <TagEditorProvider>
          {children}
        </TagEditorProvider>
      </ConfirmDialogProvider>
    </QueryClientProvider>
  )
}
