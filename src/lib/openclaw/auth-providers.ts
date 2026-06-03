export type AuthMethod = 'device-code' | 'api-key'

/** Shape that gets written under `models.providers.<id>` in openclaw.json
 * if the provider isn't already configured when a user adds auth. Without
 * this, paste-api-key creates an auth profile but the model still doesn't
 * appear in `models list` because OpenClaw has no way to call it. */
export interface ProviderConfigTemplate {
  baseUrl: string
  api: string
  models: Array<{
    id: string
    name: string
    api?: string
    reasoning?: boolean
    input?: ('text' | 'image')[]
    contextWindow?: number
    maxTokens?: number
  }>
}

export interface ProviderSpec {
  id: string
  label: string
  methods: AuthMethod[]
  apiKeyUrl?: string
  note?: string
  providerConfig?: ProviderConfigTemplate
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
    providerConfig: {
      baseUrl: 'https://api.kimi.com/coding/',
      api: 'anthropic-messages',
      models: [
        {
          id: 'kimi-code',
          name: 'Kimi Code',
          api: 'anthropic-messages',
          reasoning: true,
          input: ['text', 'image'],
          contextWindow: 262144,
          maxTokens: 32768,
        },
      ],
    },
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
