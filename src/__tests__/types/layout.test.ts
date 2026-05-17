// src/__tests__/types/layout.test.ts
import { describe, it, expect } from 'vitest'
import { viewStateToFilter } from '@/types/layout'

describe('viewStateToFilter', () => {
  it('all_photos returns isDeleted false', () => {
    const f = viewStateToFilter({ type: 'all_photos' })
    expect(f.isDeleted).toBe(false)
    expect(f.favoritesOnly).toBeUndefined()
  })

  it('favorites returns favoritesOnly true', () => {
    const f = viewStateToFilter({ type: 'favorites' })
    expect(f.favoritesOnly).toBe(true)
    expect(f.isDeleted).toBe(false)
  })

  it('recently_imported returns sortBy imported_at', () => {
    const f = viewStateToFilter({ type: 'recently_imported' })
    expect(f.sortBy).toBe('imported_at')
    expect(f.isDeleted).toBe(false)
  })

  it('album returns albumId', () => {
    const f = viewStateToFilter({ type: 'album', albumId: 'abc-123' })
    expect(f.albumId).toBe('abc-123')
  })

  it('folder returns folderPath', () => {
    const f = viewStateToFilter({ type: 'folder', folderPath: '/photos/vacation' })
    expect(f.folderPath).toBe('/photos/vacation')
  })

  it('trash returns isDeleted true', () => {
    const f = viewStateToFilter({ type: 'trash' })
    expect(f.isDeleted).toBe(true)
  })

  it('search returns isDeleted false (search handled separately)', () => {
    const f = viewStateToFilter({ type: 'search', query: 'cat' })
    expect(f.isDeleted).toBe(false)
  })
})