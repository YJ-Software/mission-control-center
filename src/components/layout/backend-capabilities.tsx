'use client'

import { createContext, useContext } from 'react'
import { capabilitiesFor, type BackendCapabilities } from '@/lib/agent-runtime/capabilities'

const BackendContext = createContext(capabilitiesFor('openclaw'))

export const BackendCapabilitiesProvider = BackendContext.Provider
export const useBackendCapabilities = () => useContext(BackendContext)
export type { BackendCapabilities }
