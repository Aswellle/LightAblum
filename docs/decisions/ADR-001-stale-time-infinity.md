# ADR-001: staleTime: Infinity + resetQueries pattern

**Status**: Accepted  
**Date**: 2026-04-26

## Context

LightAlbum's photo list query (`['photos', filter]`) uses `useInfiniteQuery` with cursor-based pagination. The data can reach tens of thousands of rows. Letting TanStack Query manage refetching automatically (default `staleTime: 0`) would cause unnecessary full-list refetches on window focus, component mount, and React Strict Mode's double-render.

Rust pushes real-time updates via Tauri events — the frontend already knows exactly when data changes. Polling is redundant.

## Decision

```ts
useInfiniteQuery({
  staleTime: Infinity,  // never auto-refetch
  gcTime: 10 * 60 * 1000,
  ...
})
```

**Rule**: Any code that needs to force a refresh MUST call `queryClient.resetQueries({ queryKey: ['photos'] })`, NOT `invalidateQueries`. With `staleTime: Infinity`, `invalidateQueries` marks data as stale but the component may not refetch because the "background refetch on stale" mechanism is bypassed by the Infinity staleTime.

`resetQueries` clears the cache entirely and triggers an immediate refetch for any active observer.

## Consequences

- **Good**: Zero unnecessary network round-trips; Rust event bus drives all invalidation.
- **Good**: No "flash of stale data" on window focus or navigation.
- **Bad**: Callers must remember to use `resetQueries` not `invalidateQueries`. Lint rule or wrapper function could enforce this but isn't implemented yet.
- **Watch out**: `invalidateQueries` in `onSettled` of mutations is correct for non-Infinity queries (e.g. `['albums']`, `['stats']`, `['folders']`) — don't reflexively change those.
