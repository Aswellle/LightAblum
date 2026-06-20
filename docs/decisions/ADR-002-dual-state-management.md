# ADR-002: Dual state — Zustand + TanStack Query

**Status**: Accepted  
**Date**: 2026-04-26

## Context

Photo grid requires two things that pull in opposite directions:

1. **Cursor-based pagination** with incremental append — TanStack Query's `useInfiniteQuery` handles this naturally.
2. **Instant optimistic mutations** (favorite toggle, batch ops) and O(1) id-based lookups — TanStack Query's cache is keyed by queryKey and awkward for item-level mutations against an infinite list.

## Decision

**TanStack Query** owns: cache invalidation, refetch scheduling, pagination state, loading/error state.

**Zustand (`photoStore`)** owns: the flat `photos[]` array that the virtual grid renders, plus the derived `groups[]` for month headers, `_groupMap` for O(pageSize) incremental append, and `_photoIndex` for O(1) `updatePhoto` lookups.

**Sync contract**:
- `usePhotoData` is the single point that reads from TanStack Query and writes to `photoStore`.
- Page 1 (or cache reset) → `setPhotos` (full rebuild).
- Page k+1 → `appendPhotos(page.items)` (incremental, O(pageSize)).
- Mutations update `photoStore` optimistically in `onMutate`; TanStack Query cache is invalidated in `onSettled`.

## Consequences

- **Good**: Virtual grid (`useVirtualGrid`) always reads from `photoStore.photos` — one stable reference, no re-derives.
- **Good**: `updatePhoto` is O(1) even for 100K+ photo lists.
- **Bad**: Two sources of truth require careful sync. `usePhotoQuery` must call `photoStore.reset()` before switching views to prevent stale data flash.
- **Bad**: New developers must understand both layers. This ADR explains why.
