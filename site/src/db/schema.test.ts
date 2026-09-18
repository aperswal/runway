import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import { ACTIVE_STATUSES, TRADE_STATUSES, funds, trades } from './schema'

describe('schema', () => {
  it('links trades to funds', () => {
    const [fk] = getTableConfig(trades).foreignKeys
    const reference = fk?.reference()
    expect(reference?.foreignTable).toBe(funds)
    expect(reference?.foreignColumns.map((c) => c.name)).toEqual(['id'])
    expect(reference?.columns.map((c) => c.name)).toEqual(['fund'])
  })

  it('allows one active lot per fund and symbol', () => {
    const [index] = getTableConfig(trades).indexes
    expect(index?.config.name).toBe('trades_one_active_per_fund_symbol')
    expect(index?.config.unique).toBe(true)
    expect(index?.config.where).toBeDefined()
    expect(index?.config.columns).toHaveLength(2)
  })

  it('treats every non-closed status as active', () => {
    expect(ACTIVE_STATUSES).toEqual(
      TRADE_STATUSES.filter((s) => s !== 'closed' && s !== 'cancelled'),
    )
  })
})
