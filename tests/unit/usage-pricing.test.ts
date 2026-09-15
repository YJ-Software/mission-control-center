import { describe, expect, it } from 'vitest'
import {
  estimateTokenCost,
  findModelPrice,
  priceDaily,
  priceModelUsage,
  type GatewayUsageTotals,
} from '@/lib/usage-pricing'

// OpenClaw reports $0 for providers whose catalog carries no cost block (kimi,
// custom endpoints), which left Daily Spend flat even with millions of tokens.

const totals = (t: Partial<GatewayUsageTotals>): GatewayUsageTotals => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0, missingCostEntries: 0, ...t,
})

describe('findModelPrice', () => {
  it('matches ids with or without the provider prefix', () => {
    expect(findModelPrice('kimi', 'k3')).toMatchObject({ input: 3, output: 15 })
    expect(findModelPrice(undefined, 'kimi-k3')).toMatchObject({ input: 3 })
    expect(findModelPrice('yuanjhen', 'deepseek-v4-flash')).toMatchObject({ input: 0.3, output: 1.2 })
    expect(findModelPrice('custom-spark-gbox-tw', 'qwen3.5-122b-a10b')).toMatchObject({ input: 0.26, output: 2.08 })
    expect(findModelPrice('minimax-cn', 'MiniMax-M2.7')).toMatchObject({ input: 0.3 })
    expect(findModelPrice('minimax', 'MiniMax-M2.7-highspeed')).toMatchObject({ input: 0.6 })
    expect(findModelPrice('kimi', 'kimi-for-coding')).toMatchObject({ input: 0.95, output: 4 })
  })

  it('does not over-match neighbouring model names', () => {
    expect(findModelPrice('zai', 'glm-4.7-flash')).toBeNull()
    expect(findModelPrice('zai', 'glm-5-turbo')).toBeNull()
    expect(findModelPrice('openai', 'gpt-5.6-terra')).toBeNull()
    expect(findModelPrice('openclaw', 'delivery-mirror')).toBeNull()
    expect(findModelPrice('x', '')).toBeNull()
  })
})

describe('estimateTokenCost', () => {
  it('prices each token class per million and falls back to input for unpublished cache rates', () => {
    const cost = estimateTokenCost(
      { input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheWrite: 1_000_000 },
      { input: 1, output: 4, cacheRead: 0.1 },
    )
    // 1*1 + 0.5*4 + 2*0.1 + 1*1(cacheWrite → input)
    expect(cost).toBeCloseTo(4.2, 10)
  })
})

describe('priceModelUsage', () => {
  it("keeps OpenClaw's figure when it priced every entry", () => {
    expect(priceModelUsage('openai', 'gpt-5.6-terra', totals({ input: 10, totalTokens: 10, totalCost: 0.74 })))
      .toEqual({ cost: 0.74, estimated: false })
  })

  it('estimates when OpenClaw left entries unpriced', () => {
    const r = priceModelUsage('kimi', 'k3', totals({ input: 1_000_000, output: 100_000, cacheRead: 10_000_000, totalTokens: 11_100_000, missingCostEntries: 18 }))
    // 1*3 + 0.1*15 + 10*0.3
    expect(r.estimated).toBe(true)
    expect(r.cost).toBeCloseTo(7.5, 10)
  })

  it('does not guess for an unknown model', () => {
    expect(priceModelUsage('mystery', 'model-x', totals({ input: 5_000_000, totalTokens: 5_000_000, missingCostEntries: 3 })))
      .toEqual({ cost: 0, estimated: false })
  })
})

describe('priceDaily', () => {
  it('spreads an estimated model cost over its days by token share and adds priced models as reported', () => {
    const byModel = [
      { provider: 'kimi', model: 'k3', totals: totals({ input: 1_000_000, output: 100_000, cacheRead: 10_000_000, totalTokens: 11_100_000, missingCostEntries: 5 }) },
      { provider: 'openai', model: 'gpt-5.6-terra', totals: totals({ input: 100, totalTokens: 100, totalCost: 0.5 }) },
    ]
    const { perDay, estimated } = priceDaily([
      { date: '2026-09-14', provider: 'kimi', model: 'k3', tokens: 2_775_000, cost: 0 },
      { date: '2026-09-15', provider: 'kimi', model: 'k3', tokens: 8_325_000, cost: 0 },
      { date: '2026-09-15', provider: 'openai', model: 'gpt-5.6-terra', tokens: 100, cost: 0.5 },
    ], byModel)
    expect(estimated).toBe(true)
    expect(perDay['2026-09-14']).toBeCloseTo(7.5 * 0.25, 10)
    expect(perDay['2026-09-15']).toBeCloseTo(7.5 * 0.75 + 0.5, 10)
  })

  it('reports not estimated when every model was priced by OpenClaw', () => {
    const r = priceDaily(
      [{ date: '2026-09-15', provider: 'openai', model: 'gpt-5.4-mini', tokens: 10, cost: 0.09 }],
      [{ provider: 'openai', model: 'gpt-5.4-mini', totals: totals({ input: 10, totalTokens: 10, totalCost: 0.09 }) }],
    )
    expect(r).toEqual({ perDay: { '2026-09-15': 0.09 }, estimated: false })
  })
})
