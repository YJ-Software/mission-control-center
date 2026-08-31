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
  /** Set when newer OpenClaw ships this provider as a first-class plugin
   * instead of a `models.providers.*` config block. Saving an auth profile for
   * such a provider before the plugin is installed AND capability-consented
   * makes the gateway refuse to start ("Plugin X requires capability consent"),
   * and it restart-loops until systemd gives up. The plugin never reaches
   * `plugins list` in that state, so `plugins enable X --accept-capabilities`
   * can't fix it either — only editing openclaw.json by hand does. So we
   * install it, with consent, before touching auth. */
  pluginId?: string
  pluginPackage?: string
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
    // OpenClaw ≥2026.8.1 ships Kimi as @openclaw/kimi-provider (manifest id
    // "kimi"). Older versions have no such plugin and use providerConfig below.
    pluginId: 'kimi',
    pluginPackage: 'clawhub:@openclaw/kimi-provider',
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
