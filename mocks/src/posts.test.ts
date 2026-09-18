import { describe, expect, it } from 'vitest'
import { PostStore } from './posts.ts'

describe('PostStore', () => {
  it('stores, filters and resets posts', () => {
    const store = new PostStore()
    store.add({ network: 'x', text: 'a', image: null, receivedAt: 't1' })
    store.add({ network: 'linkedin', text: 'b', image: null, receivedAt: 't2' })
    expect(store.list()).toHaveLength(2)
    expect(store.byNetwork('x')).toEqual([
      { network: 'x', text: 'a', image: null, receivedAt: 't1' },
    ])
    store.reset()
    expect(store.list()).toEqual([])
  })
})
