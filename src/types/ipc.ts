/**
 * @file src/types/ipc.ts
 * @description Re-export barrel — all IPC types are now split across:
 *   - filters.ts  (PhotoFilter, SearchQuery, AppSettings, Tag, ...)
 *   - events.ts   (TauriEventMap, payload types, TAURI_EVENTS)
 *   - commands.ts (IpcCommands, AlbumUpdateParams, IpcError, isIpcError)
 *
 * Existing imports of `@/types/ipc` continue to work unchanged.
 */

export * from './filters'
export * from './events'
export * from './commands'
