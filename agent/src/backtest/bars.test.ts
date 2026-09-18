import { afterEach, describe, expect, it, vi } from 'vitest'
import { SiteError } from '../errors.ts'
import { fetchDailyBars } from './bars.ts'

afterEach(() => vi.unstubAllGlobals())

const source = { siteUrl: 'https://runway.test', dataToken: 'data-tok' }
const now = new Date('2024-03-01T12:00:00Z')
const aapl = [{ t: '2024-02-21', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }]
const btc = [{ t: '2024-02-21', o: 100, h: 110, l: 90, c: 105, v: 1 }]
const page = (bars: Record<string, unknown>) =>
  new Response(JSON.stringify({ bars, next_page_token: null }))

describe('fetchDailyBars', () => {
  it('fetches stocks with the iex feed and crypto without it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page({ AAPL: aapl }))
      .mockResolvedValueOnce(page({ 'BTC/USD': btc }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchDailyBars(source, ['AAPL', 'BTC/USD'], 10, now)).resolves.toEqual({
      AAPL: aapl,
      'BTC/USD': btc,
    })
    const headers = { authorization: 'Bearer data-tok' }
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://runway.test/data/stock-bars?symbols=AAPL&timeframe=1Day&start=2024-02-20&limit=10000&feed=iex',
      { headers },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://runway.test/data/crypto-bars?symbols=BTC%2FUSD&timeframe=1Day&start=2024-02-20&limit=10000',
      { headers },
    )
  })
  it('skips a group with no symbols', async () => {
    const fetchMock = vi.fn().mockResolvedValue(page({ 'BTC/USD': btc }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchDailyBars(source, ['BTC/USD'], 10, now)).resolves.toEqual({
      'BTC/USD': btc,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]![0]).toContain('/data/crypto-bars?')
  })
  it('throws SiteError on an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 403 })))
    await expect(fetchDailyBars(source, ['AAPL'], 10, now)).rejects.toThrow(
      new SiteError(403, 'no'),
    )
  })
  it('throws SiteError on an unexpected shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"bars":[]}')))
    const error = await fetchDailyBars(source, ['AAPL'], 10, now).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SiteError)
    expect((error as SiteError).body).toMatch(/^unexpected bars shape: /)
  })
})
