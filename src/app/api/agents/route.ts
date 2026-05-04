import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { gatewayRequest } from '@/lib/gateway-rpc'

const roleMap: Record<string, { role: string; group: string; description: string }> = {
  main: { role: '主代理', group: 'operators', description: '主要 AI 助理，處理日常任務和協調工作' },
  'morning-briefing': { role: '晨報代理', group: 'operators', description: '每日自動產生晨報，彙整 AI/科技/市場資訊' },
  'moni-coding-agent': { role: '程式代理', group: 'developers', description: '專業程式撰寫與除錯助理' },
  glm: { role: 'GLM 代理', group: 'researchers', description: '使用 GLM 模型的輔助代理' },
  mini: { role: '輕量代理', group: 'operators', description: '快速回應的輕量代理' },
}

async function getAgentsViaRpc() {
  const result = await gatewayRequest('agents.list', {}) as any
  const agentList = result?.agents ?? result ?? []

  return (agentList as any[]).map((agent: any) => {
    const agentId = agent.id || agent.name
    const meta = roleMap[agentId] || { role: agentId, group: 'operators', description: '' }
    return {
      id: agentId,
      name: agent.name || agentId,
      role: meta.role,
      group: meta.group,
      description: meta.description,
      lastActive: agent.lastActive || null,
      status: agent.status || 'idle',
    }
  })
}

function getAgentsViaFilesystem() {
  const agentsDir = path.join(os.homedir(), '.openclaw', 'agents')
  const agentDirs = fs.readdirSync(agentsDir).filter(d => {
    const stat = fs.statSync(path.join(agentsDir, d))
    return stat.isDirectory()
  })

  return agentDirs.map(agentId => {
    try {
      const sessionsDir = path.join(agentsDir, agentId, 'sessions')

      let agentConfig: { id?: string; name?: string; role?: string; description?: string } = {}
      const agentFile = path.join(agentsDir, agentId, 'agent.json')
      if (fs.existsSync(agentFile)) {
        agentConfig = JSON.parse(fs.readFileSync(agentFile, 'utf-8'))
      }

      let lastActive: string | null = null
      if (fs.existsSync(sessionsDir)) {
        const sessions = fs.readdirSync(sessionsDir)
        if (sessions.length > 0) {
          const lastSession = sessions.sort().reverse()[0]
          const sessionStat = fs.statSync(path.join(sessionsDir, lastSession))
          lastActive = sessionStat.mtime.toISOString()
        }
      }

      const meta = roleMap[agentId] || { role: agentId, group: 'operators', description: '' }

      return {
        id: agentId,
        name: agentConfig.name || agentId,
        role: meta.role,
        group: meta.group,
        description: meta.description,
        lastActive,
        status: 'idle',
      }
    } catch {
      return { id: agentId, name: agentId, role: agentId, group: 'operators', description: '', lastActive: null, status: 'idle' }
    }
  })
}

export async function GET() {
  try {
    const agents = await getAgentsViaRpc()
    return NextResponse.json({ agents, source: 'rpc' })
  } catch {
    // Fallback to filesystem when gateway is unavailable
    try {
      const agents = getAgentsViaFilesystem()
      return NextResponse.json({ agents, source: 'filesystem' })
    } catch (err) {
      return NextResponse.json({ agents: [], error: String(err) })
    }
  }
}
