// LLM 頁面的列表、登入（含 PTY）與外掛檢查共用額度，避免小記憶體主機同時載入太多 CLI。
// 放在 globalThis，讓不同 Next.js route bundle 也共用同一個佇列。
const shared = globalThis as typeof globalThis & {
  __mccOpenclawCliLimiter?: { active: number; queue: (() => void)[] }
}
const state = shared.__mccOpenclawCliLimiter ??= { active: 0, queue: [] }

export async function withOpenclawCli<T>(run: () => Promise<T>): Promise<T> {
  if (state.active >= 2) await new Promise<void>((resolve) => state.queue.push(resolve))
  else state.active++
  try {
    return await run()
  } finally {
    const next = state.queue.shift()
    if (next) next() // 把額度交給下一個工作，不留下可被插隊的空檔。
    else state.active--
  }
}
