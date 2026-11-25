import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider, useTranslations } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BackupSourceStep } from '@/components/backup/backup-wizard'
import { BackendCapabilitiesProvider } from '@/components/layout/backend-capabilities'
import { MobileDrawer } from '@/components/layout/mobile-drawer'
import { capabilitiesFor, type BackendKind } from '@/lib/agent-runtime/capabilities'
import messages from '../../messages/en.json'
import './helpers/offline-owner-mocks'
import { stubHermesHome } from './helpers/hermes-test-home'

vi.mock('@/components/ui/sheet', () => {
  const content = ({ children }: { children: ReactNode }) => children
  return { Sheet: content, SheetContent: content, SheetHeader: content, SheetTitle: content }
})
vi.mock('@/components/layout/mobile-nav-item', () => ({ MobileNavItem: () => null }))
vi.mock('@/components/layout/gateway-status-label', () => ({ GatewayStatusLabel: () => null }))

let state: ReturnType<typeof stubHermesHome>
beforeEach(() => { state = stubHermesHome() })
afterEach(() => {
  vi.unstubAllEnvs()
  state.cleanup()
})

function render(backend: BackendKind, content: ReactNode, backendVersion?: string) {
  const client = new QueryClient()
  client.setQueryData(['app-version'], { backend: { version: backendVersion } })
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale: 'en', messages, timeZone: 'UTC',
    children: createElement(QueryClientProvider, { client },
      createElement(BackendCapabilitiesProvider, { value: capabilitiesFor(backend) }, content),
    ),
  }))
}

it('labels the Hermes mobile drawer with its detected version and falls back to the backend name', () => {
  const drawer = createElement(MobileDrawer, { open: true, onOpenChange: vi.fn() })
  const detected = render('hermes', drawer, '0.21.5')
  expect(detected).toContain('HERMES v0.21.5')
  expect(detected).not.toContain('OPENCLAW')
  expect(render('hermes', drawer)).toContain('>HERMES<')
  expect(render('openclaw', drawer)).toContain('OPENCLAW v2.0')
})

function SourceStep() {
  const t = useTranslations('backup')
  return createElement(BackupSourceStep, { t, selected: [], onChange: vi.fn(), openClaw: true, onOpenClawChange: vi.fn() })
}

it.each([['hermes', 'Hermes'], ['openclaw', 'OpenClaw']] as const)(
  'names the %s backend in the backup wizard source hint',
  (backend, label) => {
    expect(render(backend, createElement(SourceStep))).toContain(
      `${label} data is included by default. Optionally add extra folders.`,
    )
  },
)
