/**
 * Approximate LLM spend from token counts.
 *
 * OpenClaw prices usage from each model's catalog `cost` block, but most custom
 * and coding-plan providers ship that block zeroed or absent, so their usage —
 * often the bulk of it — comes back as $0 with `missingCostEntries`. This fills
 * the gap with public pay-as-you-go list prices.
 *
 * Prices are USD per 1M tokens, checked on PRICING_CHECKED_AT. Self-hosted and
 * reseller endpoints are priced at the equivalent public API rate, so every
 * figure produced here is an estimate, not a bill.
 *
 * Sources (2026-09-15):
 * - DeepSeek V4.1 Flash, peak rate (off-peak is half): https://deepseek.ai/pricing
 * - Kimi K3: https://benchlm.ai/moonshot/api-pricing
 * - Kimi K2.7 Code / kimi-for-coding: https://costgoat.com/pricing/kimi-api
 * - Qwen3.5 (Alibaba Model Studio): https://developer.puter.com/tutorials/qwen-api-pricing/
 * - GLM-5 / GLM-4.7: https://developer.puter.com/tutorials/zai-glm-api-pricing/
 * - MiniMax M2.7: https://openrouter.ai/minimax/minimax-m2.7
 */

export const PRICING_CHECKED_AT = '2026-09-15'

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** USD per 1M tokens. Cache rates fall back to the input rate when a provider publishes none. */
export interface ModelPrice {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

interface PriceRule {
  label: string
  match: RegExp
  price: ModelPrice
}

// Order matters: the first matching rule wins, so narrower ids come first.
const RULES: PriceRule[] = [
  { label: 'DeepSeek V4 Flash', match: /deepseek-v4(?:\.\d+)?-flash/, price: { input: 0.3, output: 1.2, cacheRead: 0.006 } },
  { label: 'Kimi K2.7 Code', match: /kimi-for-coding|kimi-code|k2\.7-code/, price: { input: 0.95, output: 4, cacheRead: 0.19 } },
  { label: 'Kimi K3', match: /(?:^|\/)(?:kimi-)?k3$/, price: { input: 3, output: 15, cacheRead: 0.3 } },
  { label: 'Qwen3.5-35B-A3B', match: /qwen3\.5-35b-a3b/, price: { input: 0.1, output: 0.9 } },
  { label: 'Qwen3.5-122B-A10B', match: /qwen3\.5-122b-a10b/, price: { input: 0.26, output: 2.08 } },
  { label: 'GLM-5', match: /(?:^|\/)glm-5$/, price: { input: 1, output: 3.2 } },
  { label: 'GLM-4.7', match: /(?:^|\/)glm-4\.7$/, price: { input: 0.6, output: 2.2, cacheRead: 0.11 } },
  { label: 'MiniMax M2.7 highspeed', match: /minimax-m2\.7-highspeed/, price: { input: 0.6, output: 2.4, cacheRead: 0.06, cacheWrite: 0.375 } },
  { label: 'MiniMax M2.7', match: /minimax-m2\.7$/, price: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 } },
]

/** Display names of the models with a list price, in table order. */
export const PRICED_MODEL_LABELS: readonly string[] = RULES.map((r) => r.label)

/** List price for a model id, matched with and without its provider prefix; null when unknown. */
export function findModelPrice(provider: string | undefined, model: string): ModelPrice | null {
  const id = model.trim().toLowerCase()
  if (!id) return null
  const full = provider ? `${provider.trim().toLowerCase()}/${id}` : id
  for (const rule of RULES) {
    if (rule.match.test(full) || rule.match.test(id)) return rule.price
  }
  return null
}

export function estimateTokenCost(usage: TokenUsage, price: ModelPrice): number {
  const per = (tokens: number, rate: number) => ((tokens || 0) / 1_000_000) * rate
  return (
    per(usage.input, price.input) +
    per(usage.output, price.output) +
    per(usage.cacheRead, price.cacheRead ?? price.input) +
    per(usage.cacheWrite, price.cacheWrite ?? price.input)
  )
}

/** The per-model totals block the Gateway's usage RPCs return. */
export interface GatewayUsageTotals extends TokenUsage {
  totalTokens: number
  totalCost: number
  missingCostEntries?: number
}

export interface PricedCost {
  cost: number
  estimated: boolean
}

/**
 * OpenClaw's own figure wins when it priced every entry for the model;
 * otherwise estimate from tokens. An unknown model keeps whatever OpenClaw
 * reported (usually 0) rather than guessing.
 */
export function priceModelUsage(
  provider: string | undefined,
  model: string,
  totals: GatewayUsageTotals,
): PricedCost {
  if (totals.totalCost > 0 && !(totals.missingCostEntries ?? 0)) {
    return { cost: totals.totalCost, estimated: false }
  }
  const price = findModelPrice(provider, model)
  if (!price) return { cost: totals.totalCost || 0, estimated: false }
  return { cost: estimateTokenCost(totals, price), estimated: true }
}

export interface ModelDailyEntry {
  date: string
  provider?: string
  model: string
  tokens: number
  cost: number
}

export interface ModelTotalsEntry {
  provider?: string
  model: string
  totals: GatewayUsageTotals
}

const modelKey = (provider: string | undefined, model: string) => `${provider ?? ''}/${model}`

/**
 * Price each day. `modelDaily` carries only a day's total tokens per model, not
 * the input/output/cache split, so an estimated model's window cost is spread
 * across its days by token share.
 */
export function priceDaily(
  modelDaily: ModelDailyEntry[],
  byModel: ModelTotalsEntry[],
): { perDay: Record<string, number>; estimated: boolean } {
  const totalsByModel = new Map(byModel.map((e) => [modelKey(e.provider, e.model), e.totals]))
  const perDay: Record<string, number> = {}
  let estimated = false
  for (const day of modelDaily) {
    let cost = day.cost || 0
    const totals = totalsByModel.get(modelKey(day.provider, day.model))
    if (totals && totals.totalTokens > 0) {
      const priced = priceModelUsage(day.provider, day.model, totals)
      if (priced.estimated) {
        cost = priced.cost * ((day.tokens || 0) / totals.totalTokens)
        estimated = true
      }
    }
    perDay[day.date] = (perDay[day.date] ?? 0) + cost
  }
  return { perDay, estimated }
}
