export type AuthMethod = 'device-code' | 'api-key'

export interface ProviderSpec {
  id: string
  label: string
  methods: AuthMethod[]
  apiKeyUrl?: string
  note?: string
}

export const KNOWN_PROVIDERS: ProviderSpec[] = [
  {
    id: 'openai-codex',
    label: 'OpenAI Codex (ChatGPT login)',
    methods: ['device-code', 'api-key'],
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    methods: ['api-key'],
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    methods: ['api-key'],
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'zai',
    label: 'Z.AI (GLM)',
    methods: ['api-key'],
    apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
  },
  {
    id: 'kimi',
    label: 'Moonshot Kimi',
    methods: ['api-key'],
    apiKeyUrl: 'https://platform.moonshot.ai/console/api-keys',
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    methods: ['api-key'],
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    methods: ['api-key'],
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  },
  {
    id: 'minimax-cn',
    label: 'MiniMax (CN)',
    methods: ['api-key'],
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  },
]

export function findProvider(id: string): ProviderSpec | undefined {
  return KNOWN_PROVIDERS.find((p) => p.id === id)
}
