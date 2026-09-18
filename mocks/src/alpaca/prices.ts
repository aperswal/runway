const FNV_OFFSET = 2166136261
const FNV_PRIME = 16777619
const UINT32 = 4294967296
const MULBERRY_INCREMENT = 0x6d2b79f5
const MULBERRY_MIX_A = 15
const MULBERRY_MIX_B = 7
const MULBERRY_MIX_C = 61
const MULBERRY_MIX_D = 14
const BASE_PRICE_FLOOR = 10
const BASE_PRICE_SPAN = 990
const DRIFT_RANGE = 0.01
const CENTS = 100
const QTY_PLACES = 9
const HALF = 0.5
const QUOTE_CURRENCY = 'USD'

export const hashSymbol = (symbol: string): number => {
  let hash = FNV_OFFSET
  for (let index = 0; index < symbol.length; index += 1) {
    hash ^= symbol.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + MULBERRY_INCREMENT) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> MULBERRY_MIX_A), t | 1)
    t ^= t + Math.imul(t ^ (t >>> MULBERRY_MIX_B), t | MULBERRY_MIX_C)
    return ((t ^ (t >>> MULBERRY_MIX_D)) >>> 0) / UINT32
  }
}

export const roundCents = (value: number): number => Math.round(value * CENTS) / CENTS

export const roundQty = (value: number): number => Number(value.toFixed(QTY_PLACES))

export const isCrypto = (symbol: string): boolean =>
  symbol.includes('/') || symbol.endsWith(QUOTE_CURRENCY)

export const canonicalSymbol = (symbol: string): string => {
  const upper = symbol.toUpperCase()
  if (upper.includes('/') || !upper.endsWith(QUOTE_CURRENCY)) {
    return upper
  }
  return `${upper.slice(0, -QUOTE_CURRENCY.length)}/${QUOTE_CURRENCY}`
}

export const positionSymbol = (symbol: string): string => canonicalSymbol(symbol).replace('/', '')

const OPTION_PATTERN = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/
const PREMIUM_SCALE = 100

export const isOptionSymbol = (symbol: string): boolean => OPTION_PATTERN.test(symbol)
export const multiplierOf = (symbol: string): number => (isOptionSymbol(symbol) ? PREMIUM_SCALE : 1)

export const basePrice = (symbol: string): number => {
  const base = BASE_PRICE_FLOOR + (hashSymbol(canonicalSymbol(symbol)) % BASE_PRICE_SPAN)
  return isOptionSymbol(symbol) ? roundCents(base / PREMIUM_SCALE) : base
}

export class PriceFeed {
  private prices = new Map<string, number>()
  private generators = new Map<string, () => number>()

  current(symbol: string): number {
    const key = canonicalSymbol(symbol)
    const previous = this.prices.get(key) ?? basePrice(key)
    const next = roundCents(previous * (1 + (this.generator(key)() - HALF) * DRIFT_RANGE))
    this.prices.set(key, next)
    return next
  }

  set(symbol: string, price: number): void {
    this.prices.set(canonicalSymbol(symbol), roundCents(price))
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.prices)
  }

  reset(): void {
    this.prices = new Map()
    this.generators = new Map()
  }

  private generator(key: string): () => number {
    const existing = this.generators.get(key)
    if (existing !== undefined) {
      return existing
    }
    const created = mulberry32(hashSymbol(key))
    this.generators.set(key, created)
    return created
  }
}
