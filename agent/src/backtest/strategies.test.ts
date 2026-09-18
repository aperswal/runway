import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARAMS,
  PORTFOLIO_STRATEGY_NAMES,
  STRATEGIES,
  STRATEGY_NAMES,
  isPortfolioStrategyName,
  isStrategyName,
  rsi,
  sma,
  zScore,
} from './strategies.ts'

const params = { ...DEFAULT_PARAMS, fast: 2, slow: 3, lookback: 2, period: 2, low: 30, entry: 1 }

describe('DEFAULT_PARAMS', () => {
  it('pins the documented defaults', () =>
    expect(DEFAULT_PARAMS).toEqual({
      fast: 10,
      slow: 50,
      lookback: 20,
      period: 14,
      low: 30,
      high: 70,
      entry: 2,
      exit: 0.5,
      top: 3,
      rebalance: 20,
    }))
})

describe('strategy names', () => {
  it('lists the per-symbol strategies', () =>
    expect(STRATEGY_NAMES).toEqual(['sma-cross', 'breakout', 'rsi', 'momentum', 'mean-reversion']))
  it('lists the portfolio strategies', () =>
    expect(PORTFOLIO_STRATEGY_NAMES).toEqual(['pairs', 'xs-momentum']))
})

describe('sma', () => {
  it('averages the trailing window', () => expect(sma([1, 2, 3, 4], 3, 2)).toBe(3.5))
  it('averages a window ending mid-series', () => expect(sma([1, 2, 3, 4], 2, 3)).toBe(2))
})

describe('rsi', () => {
  it('returns null before the period fills', () => expect(rsi([1, 2], 1, 2)).toBeNull())
  it('is 100 when there are no losses', () => expect(rsi([1, 2, 3], 2, 2)).toBe(100))
  it('is 100 when prices are flat', () => expect(rsi([1, 1, 1], 2, 2)).toBe(100))
  it('is 0 when there are no gains', () => expect(rsi([3, 2, 1], 2, 2)).toBe(0))
  it('weighs gains against losses', () => expect(rsi([1, 3, 2], 2, 2)).toBeCloseTo(66.667))
  it('is 50 when gains equal losses', () => expect(rsi([1, 3, 1], 2, 2)).toBe(50))
  it('treats missing values as zero', () => expect(rsi([1, 2], 3, 2)).toBe(0))
})

describe('sma-cross', () => {
  const strategy = STRATEGIES['sma-cross'](params)
  it('is flat until both averages exist', () => {
    expect(strategy([1, 2, 3, 4], 0)).toBe('flat')
    expect(strategy([1, 2, 3, 4], 1)).toBe('flat')
  })
  it('is long when the fast average is above the slow one', () =>
    expect(strategy([1, 2, 3, 4], 2)).toBe('long'))
  it('is flat when the fast average is below', () => expect(strategy([4, 3, 2, 1], 2)).toBe('flat'))
  it('is flat when the averages are equal', () => expect(strategy([2, 2, 2], 2)).toBe('flat'))
  it('waits for the longer window when fast is the longer one', () =>
    expect(STRATEGIES['sma-cross']({ ...params, fast: 3, slow: 2 })([4, 3, 2], 1)).toBe('flat'))
})

describe('breakout', () => {
  const strategy = STRATEGIES.breakout(params)
  it('is flat before the lookback fills', () => expect(strategy([1, 2, 3], 1)).toBe('flat'))
  it('is long on a new high', () => expect(strategy([1, 2, 3], 2)).toBe('long'))
  it('is flat below the prior high', () => expect(strategy([1, 3, 2], 2)).toBe('flat'))
  it('is flat at exactly the prior high', () => expect(strategy([1, 3, 3], 2)).toBe('flat'))
  it('treats a missing close as zero', () => expect(strategy([1, 2, 3], 3)).toBe('flat'))
  it('treats a lookback window past the series as empty', () =>
    expect(strategy([1, 2], 5)).toBe('long'))
})

describe('rsi strategy', () => {
  const strategy = STRATEGIES.rsi(params)
  it('is flat without a value', () => expect(strategy([3, 2, 1], 1)).toBe('flat'))
  it('is long when oversold', () => expect(strategy([3, 2, 1], 2)).toBe('long'))
  it('is flat otherwise', () => expect(strategy([1, 2, 3], 2)).toBe('flat'))
  it('is flat at exactly the low threshold', () =>
    expect(STRATEGIES.rsi({ ...params, low: 50 })([1, 3, 1], 2)).toBe('flat'))
})

describe('momentum', () => {
  const strategy = STRATEGIES.momentum({ ...params, lookback: 1 })
  it('is flat before the lookback fills', () => expect(strategy([1, 2], 0)).toBe('flat'))
  it('is long when the close rose', () => expect(strategy([1, 2], 1)).toBe('long'))
  it('is flat when the close fell', () => expect(strategy([2, 1], 1)).toBe('flat'))
  it('treats missing closes as zero', () => expect(strategy([1, 2], 5)).toBe('flat'))
})

describe('zScore', () => {
  it('returns null before the window fills', () => expect(zScore([1, 3], 0, 2)).toBeNull())
  it('scores the last value against the window', () => expect(zScore([1, 3], 1, 2)).toBe(1))
  it('is negative below the mean', () => expect(zScore([3, 1], 1, 2)).toBe(-1))
  it('uses the population deviation of the window', () =>
    expect(zScore([0, 1, 2, 6], 3, 3)).toBeCloseTo(1.3887, 3))
  it('is zero for a zero-variance window', () => expect(zScore([2, 2, 2], 2, 3)).toBe(0))
  it('is zero when the end index is past the series', () => expect(zScore([1, 3, 5], 3, 3)).toBe(0))
})

describe('mean-reversion', () => {
  const strategy = STRATEGIES['mean-reversion'](params)
  it('is flat before the lookback fills', () => expect(strategy([3, 1], 0)).toBe('flat'))
  it('is flat before the lookback fills even when entry is zero', () =>
    expect(STRATEGIES['mean-reversion']({ ...params, entry: 0 })([3, 1], 0)).toBe('flat'))
  it('is long at exactly the entry z-score', () => expect(strategy([3, 1], 1)).toBe('long'))
  it('is flat above the mean', () => expect(strategy([1, 3], 1)).toBe('flat'))
  it('is flat when the dip is shallower than the entry', () =>
    expect(STRATEGIES['mean-reversion']({ ...params, entry: 2 })([3, 1], 1)).toBe('flat'))
})

describe('isPortfolioStrategyName', () => {
  it('accepts known names', () => expect(isPortfolioStrategyName('pairs')).toBe(true))
  it('rejects per-symbol names', () => expect(isPortfolioStrategyName('momentum')).toBe(false))
  it('rejects a missing name', () => expect(isPortfolioStrategyName(undefined)).toBe(false))
})

describe('isStrategyName', () => {
  it('accepts known names', () => expect(isStrategyName('momentum')).toBe(true))
  it('rejects unknown names', () => expect(isStrategyName('magic')).toBe(false))
  it('rejects portfolio names', () => expect(isStrategyName('pairs')).toBe(false))
  it('rejects a missing name', () => expect(isStrategyName(undefined)).toBe(false))
})
