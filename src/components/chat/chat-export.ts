import type { ChatMessage } from '@/hooks/use-chat-session'

export function exportChatAsMarkdown(messages: ChatMessage[], agentName: string) {
  const lines: string[] = []
  lines.push(`# Chat with ${agentName || 'Assistant'}`)
  lines.push(`> Exported: ${new Date().toISOString()}\n`)

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'You' : agentName || 'Assistant'
    const time = msg.timestamp
      ? new Date(msg.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
      : ''
    lines.push(`## ${role} ${time ? `(${time})` : ''}`)
    lines.push(msg.content)

    if (msg.toolCalls?.length) {
      lines.push('\n<details><summary>Tool Calls</summary>\n')
      for (const tc of msg.toolCalls) {
        lines.push(`**${tc.name}**`)
        if (tc.args) lines.push('```json\n' + JSON.stringify(tc.args, null, 2) + '\n```')
        if (tc.output) lines.push('Output:\n```\n' + tc.output + '\n```')
      }
      lines.push('</details>')
    }
    lines.push('')
  }

  const content = lines.join('\n')
  const date = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')
  const filename = `chat-${agentName || 'session'}-${date}.md`

  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
