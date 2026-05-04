declare module '@/lib/novnc/rfb.js' {
  interface RFBCredentials {
    password?: string
    username?: string
    target?: string
  }

  interface RFBOptions {
    shared?: boolean
    credentials?: RFBCredentials
    wsProtocols?: string[]
  }

  export default class RFB {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: RFBOptions)

    scaleViewport: boolean
    resizeSession: boolean
    clipViewport: boolean
    viewOnly: boolean
    showDotCursor: boolean

    clipboardPasteFrom(text: string): void
    sendCredentials(credentials: RFBCredentials): void
    sendCtrlAltDel(): void
    disconnect(): void
    focus(): void
    blur(): void
    addEventListener(event: string, handler: (...args: any[]) => void): void
    removeEventListener(event: string, handler: (...args: any[]) => void): void
  }
}
