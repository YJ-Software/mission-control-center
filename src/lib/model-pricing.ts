/**
 * Shared model pricing & cost estimation.
 * Used by both Sessions and Costs features.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

export interface ModelRates {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const DEFAULT_MODEL_PRICING: Record<string, ModelRates> = {
  'anthropic/claude-opus-4-6': { input: 15.00, output: 75.00, cacheRead: 1.875, cacheWrite: 18.75 },
  'anthropic/claude-opus-4-5': { input: 15.00, output: 75.00, cacheRead: 1.875, cacheWrite: 18.75 },
  'anthropic/claude-sonnet-4-6': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'anthropic/claude-sonnet-4-5': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'anthropic/claude-3-5-haiku-latest': { input: 0.80, output: 4.00, cacheRead: 0.08, cacheWrite: 1.00 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60, cacheRead: 0.075, cacheWrite: 0.30 },
  'openai/gpt-4.1-mini': { input: 0.40, output: 1.60, cacheRead: 0.20, cacheWrite: 0.80 },
  'google/gemini-3-pro-preview': { input: 1.25, output: 10.00, cacheRead: 0.31, cacheWrite: 4.50 },
  'google/gemini-3-flash-preview': { input: 0.15, output: 0.60, cacheRead: 0.04, cacheWrite: 0.15 },
  'xai/grok-4-1-fast': { input: 0.20, output: 0.50, cacheRead: 0.05, cacheWrite: 0.20 },
}

function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function normalizeProvider(provider: string | undefined): string {
  return String(provider || 'unknown').trim().toLowerCase()
}

export function normalizeModel(provider: string, model: string | undefined): string {
  const p = normalizeProvider(provider)
  let m = String(model || 'unknown').trim()
  const pref = p + '/'
  if (m.toLowerCase().startsWith(pref)) m = m.slice(pref.length)
  const ml = m.toLowerCase()
  if (p === 'anthropic') {
    if (ml.startsWith('claude-opus-4-6')) return 'claude-opus-4-6'
    if (ml.startsWith('claude-opus-4-5')) return 'claude-opus-4-5'
    if (ml.startsWith('claude-sonnet-4-6')) return 'claude-sonnet-4-6'
    if (ml.startsWith('claude-sonnet-4-5')) return 'claude-sonnet-4-5'
    if (ml.startsWith('claude-3-5-haiku')) return 'claude-3-5-haiku-latest'
  }
  if (p === 'openai') {
    if (ml.startsWith('gpt-4o-mini')) return 'gpt-4o-mini'
    if (ml.startsWith('gpt-4.1-mini')) return 'gpt-4.1-mini'
  }
  if (p === 'google' && ml.startsWith('gemini-3-flash-preview')) return 'gemini-3-flash-preview'
  if (p === 'xai' && ml.startsWith('grok-4-1-fast')) return 'grok-4-1-fast'
  return m
}

function loadModelPricing(): Record<string, ModelRates> {
  try {
    const openclawDir = path.join(os.homedir(), '.openclaw')
    const pricingFile = path.join(openclawDir, 'data', 'model_pricing_usd_per_million.json')
    if (!fs.existsSync(pricingFile)) return { ...DEFAULT_MODEL_PRICING }
    const parsed = JSON.parse(fs.readFileSync(pricingFile, 'utf-8'))
    const rates = parsed?.rates_usd_per_million
    if (!rates || typeof rates !== 'object') return { ...DEFAULT_MODEL_PRICING }
    const out: Record<string, ModelRates> = {}
    for (const [k, v] of Object.entries(rates)) {
      if (!k.includes('/') || !v || typeof v !== 'object') continue
      const r = v as Record<string, unknown>
      out[k] = {
        input: toNum(r.input),
        output: toNum(r.output),
        cacheRead: toNum(r.cacheRead),
        cacheWrite: toNum(r.cacheWrite),
      }
    }
    return Object.keys(out).length ? out : { ...DEFAULT_MODEL_PRICING }
  } catch {
    return { ...DEFAULT_MODEL_PRICING }
  }
}

export const MODEL_PRICING = loadModelPricing()

export interface MessageUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  cost?: { total?: number }
}

export function estimateMsgCost(msg: { provider?: string; model?: string; usage?: MessageUsage }): number {
  const usage = msg?.usage ?? {}
  const explicit = toNum(usage.cost?.total)
  if (explicit > 0) return explicit
  const provider = normalizeProvider(msg?.provider)
  const modelNorm = normalizeModel(provider, msg?.model)
  const rates = MODEL_PRICING[`${provider}/${modelNorm}`]
  if (!rates) return 0
  const input = Math.max(0, toNum(usage.input)) / 1_000_000
  const output = Math.max(0, toNum(usage.output)) / 1_000_000
  const cacheRead = Math.max(0, toNum(usage.cacheRead)) / 1_000_000
  const cacheWrite = Math.max(0, toNum(usage.cacheWrite)) / 1_000_000
  return (
    input * rates.input +
    output * rates.output +
    cacheRead * rates.cacheRead +
    cacheWrite * rates.cacheWrite
  )
}
