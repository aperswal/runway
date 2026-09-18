export type BuyOrder =
  | { symbol: string; notional: number; qty?: undefined; limit: null }
  | { symbol: string; qty: number; notional?: undefined; limit: number | null }

const TERMINAL_ORDER_STATUSES = ['canceled', 'expired', 'rejected']
const OPTION_MULTIPLIER = 100

export const isCrypto = (symbol: string): boolean => symbol.includes('/')
export const isOption = (symbol: string): boolean => /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(symbol)
export const contractMultiplier = (symbol: string): number =>
  isOption(symbol) ? OPTION_MULTIPLIER : 1
export const positionSymbol = (symbol: string): string => symbol.replace('/', '')
export const isTerminalOrder = (status: string): boolean => TERMINAL_ORDER_STATUSES.includes(status)
export const isWholeShares = (qty: number | undefined): boolean => Number.isInteger(qty)
const isStock = (symbol: string): boolean => !isCrypto(symbol) && !isOption(symbol)
export const timeInForce = (symbol: string): 'gtc' | 'day' => (isCrypto(symbol) ? 'gtc' : 'day')
export const tradesExtended = (symbol: string, qty: number | undefined): boolean =>
  isStock(symbol) && isWholeShares(qty)
export const extendedHours = (order: BuyOrder): boolean =>
  order.limit !== null && tradesExtended(order.symbol, order.qty)
