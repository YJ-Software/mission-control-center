'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Lock, AlertCircle, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const t = useTranslations('login')
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        router.push('/dashboard')
        router.refresh()
      } else {
        setError(t('invalidPassword'))
        setPassword('')
      }
    } catch {
      setError(t('networkError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-cyan-400/10 border border-cyan-400/20">
            <Lock className="w-5 h-5 text-cyan-400" />
          </div>
          <h1 className="text-lg font-semibold text-white/90">Mission Control</h1>
          <p className="text-xs text-white/40 font-mono tracking-wide">{t('subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="cyber-card p-5 space-y-4">
          <div>
            <label className="font-mono text-[10px] tracking-widest text-white/35 mb-1.5 block">
              {t('password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              required
              className="font-mono text-sm bg-white/[0.04] border border-white/[0.1] text-white/85 focus:border-cyan-400/40 focus:bg-white/[0.07] outline-none px-3 py-2.5 tracking-wide w-full rounded-xl transition-all"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs font-mono">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/20 disabled:opacity-40 transition-all rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-medium"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('signIn')}
          </button>
        </form>
      </div>
    </div>
  )
}
