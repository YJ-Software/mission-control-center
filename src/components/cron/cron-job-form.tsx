'use client'

import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export interface CronJobFormData {
  name: string
  description: string
  scheduleKind: 'cron' | 'at' | 'every'
  cron: string
  at: string
  every: string
  timezone: string
  stagger: string
  sessionTarget: 'main' | 'isolated'
  message: string
  systemEvent: string
  agentId: string
  model: string
  thinking: string
  timeoutSeconds: number
  deliveryMode: 'announce' | 'webhook' | 'none'
  channel: string
  to: string
  webhookUrl: string
  bestEffort: boolean
  enabled: boolean
  deleteAfterRun: boolean
  wake: 'now' | 'next-heartbeat'
}

export const defaultFormData: CronJobFormData = {
  name: '',
  description: '',
  scheduleKind: 'cron',
  cron: '',
  at: '',
  every: '',
  timezone: 'Asia/Taipei',
  stagger: '',
  sessionTarget: 'isolated',
  message: '',
  systemEvent: '',
  agentId: '',
  model: '',
  thinking: '',
  timeoutSeconds: 300,
  deliveryMode: 'announce',
  channel: 'last',
  to: '',
  webhookUrl: '',
  bestEffort: false,
  enabled: true,
  deleteAfterRun: false,
  wake: 'now',
}

interface CronJobFormProps {
  value: CronJobFormData
  onChange: (data: CronJobFormData) => void
  mode?: 'create' | 'edit'
}

const inputClass =
  'bg-white/[0.03] border border-white/[0.08] text-white/80 text-sm font-mono rounded-lg px-3 py-2 w-full focus:border-cyan-500/50 focus:outline-none'

const selectClass =
  'bg-white/[0.03] border border-white/[0.08] text-white/80 text-sm font-mono rounded-lg px-3 py-2 w-full focus:border-cyan-500/50 outline-none appearance-none'

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-xs font-mono tracking-wider text-white/50 uppercase">{title}</h3>
      {description && <p className="text-xs font-mono text-white/30 mt-0.5">{description}</p>}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-mono text-white/50 mb-1 block">{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-mono text-white/30 mt-1">{children}</p>
}

function RadioGroup({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; description?: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
              active
                ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400'
                : 'bg-white/[0.03] border-white/[0.08] text-white/50 hover:text-white/70 hover:border-white/[0.15]'
            }`}
            title={opt.description}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function CheckboxField({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded border-white/20 bg-white/[0.03] accent-cyan-500"
      />
      <div>
        <span className="text-xs font-mono text-white/60 group-hover:text-white/80 transition-colors">
          {label}
        </span>
        {hint && <p className="text-xs font-mono text-white/30 mt-0.5">{hint}</p>}
      </div>
    </label>
  )
}

export function CronJobForm({ value, onChange }: CronJobFormProps) {
  const t = useTranslations('cronJobs')

  const { data: modelsData } = useQuery<{ models: { id: string; name: string }[]; defaultModel: string }>({
    queryKey: ['morning-report-models'],
    queryFn: () => fetch('/api/morning-report?type=models').then(r => r.json()),
  })
  const availableModels = modelsData?.models ?? []
  const defaultModel = modelsData?.defaultModel ?? ''

  const { data: agentsData } = useQuery<{ agents: { id: string; name: string; role: string }[] }>({
    queryKey: ['agents-list'],
    queryFn: () => fetch('/api/agents').then(r => r.json()),
  })
  const availableAgents = agentsData?.agents ?? []

  const update = <K extends keyof CronJobFormData>(key: K, val: CronJobFormData[K]) => {
    onChange({ ...value, [key]: val })
  }

  return (
    <div className="space-y-0">
      {/* Section 1: 基本資訊 */}
      <div>
        <SectionHeader title={t('sectionBasic')} description={t('sectionBasicDesc')} />
        <div className="space-y-3">
          <div>
            <FieldLabel>{t('fieldName')} *</FieldLabel>
            <Input
              value={value.name}
              onChange={e => update('name', e.target.value)}
              placeholder={t('fieldNamePlaceholder')}
              className={inputClass}
              required
            />
            <Hint>{t('sectionBasicDesc')}</Hint>
          </div>
          <div>
            <FieldLabel>{t('fieldDescription')}</FieldLabel>
            <Input
              value={value.description}
              onChange={e => update('description', e.target.value)}
              placeholder={t('fieldDescriptionPlaceholder')}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-white/[0.06] pt-4 mt-4" />

      {/* Section 2: 排程設定 */}
      <div>
        <SectionHeader title={t('sectionSchedule')} description={t('sectionScheduleDesc')} />
        <div className="space-y-3">
          <div>
            <FieldLabel>{t('scheduleKind')}</FieldLabel>
            <RadioGroup
              value={value.scheduleKind}
              onChange={v => update('scheduleKind', v as CronJobFormData['scheduleKind'])}
              options={[
                { value: 'cron', label: t('scheduleKindCron'), description: t('scheduleKindCronDesc') },
                { value: 'at', label: t('scheduleKindAt'), description: t('scheduleKindAtDesc') },
                { value: 'every', label: t('scheduleKindEvery'), description: t('scheduleKindEveryDesc') },
              ]}
            />
          </div>

          {value.scheduleKind === 'cron' && (
            <>
              <div>
                <FieldLabel>{t('fieldCron')}</FieldLabel>
                <Input
                  value={value.cron}
                  onChange={e => update('cron', e.target.value)}
                  placeholder={t('fieldCronPlaceholder')}
                  className={inputClass}
                />
                <Hint>{t('fieldCronHint')}</Hint>
              </div>
              <div>
                <FieldLabel>{t('fieldTimezone')}</FieldLabel>
                <Input
                  value={value.timezone}
                  onChange={e => update('timezone', e.target.value)}
                  placeholder="Asia/Taipei"
                  className={inputClass}
                />
                <Hint>{t('fieldTimezoneHint')}</Hint>
              </div>
              <div>
                <FieldLabel>{t('fieldStagger')}</FieldLabel>
                <Input
                  value={value.stagger}
                  onChange={e => update('stagger', e.target.value)}
                  placeholder={t('fieldStaggerPlaceholder')}
                  className={inputClass}
                />
                <Hint>{t('fieldStaggerHint')}</Hint>
              </div>
            </>
          )}

          {value.scheduleKind === 'at' && (
            <>
              <div>
                <FieldLabel>{t('fieldAt')}</FieldLabel>
                <Input
                  value={value.at}
                  onChange={e => update('at', e.target.value)}
                  placeholder={t('fieldAtPlaceholder')}
                  className={inputClass}
                />
                <Hint>{t('fieldAtHint')}</Hint>
              </div>
              <CheckboxField
                checked={value.deleteAfterRun}
                onChange={v => update('deleteAfterRun', v)}
                label={t('fieldDeleteAfterRun')}
                hint={t('fieldDeleteAfterRunHint')}
              />
            </>
          )}

          {value.scheduleKind === 'every' && (
            <div>
              <FieldLabel>{t('fieldEvery')}</FieldLabel>
              <Input
                value={value.every}
                onChange={e => update('every', e.target.value)}
                placeholder={t('fieldEveryPlaceholder')}
                className={inputClass}
              />
              <Hint>{t('fieldEveryHint')}</Hint>
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-white/[0.06] pt-4 mt-4" />

      {/* Section 3: 執行設定 */}
      <div>
        <SectionHeader title={t('sectionExecution')} description={t('sectionExecutionDesc')} />
        <div className="space-y-3">
          <div>
            <FieldLabel>{t('sessionTarget')}</FieldLabel>
            <RadioGroup
              value={value.sessionTarget}
              onChange={v => update('sessionTarget', v as CronJobFormData['sessionTarget'])}
              options={[
                { value: 'isolated', label: t('sessionIsolated'), description: t('sessionIsolatedDesc') },
                { value: 'main', label: t('sessionMain'), description: t('sessionMainDesc') },
              ]}
            />
          </div>

          {value.sessionTarget === 'isolated' && (
            <div>
              <FieldLabel>{t('fieldMessage')}</FieldLabel>
              <Textarea
                value={value.message}
                onChange={e => update('message', e.target.value)}
                placeholder={t('fieldMessagePlaceholder')}
                className={inputClass + ' min-h-[80px]'}
                rows={3}
              />
              <Hint>{t('fieldMessageHint')}</Hint>
            </div>
          )}

          {value.sessionTarget === 'main' && (
            <div>
              <FieldLabel>{t('fieldSystemEvent')}</FieldLabel>
              <Textarea
                value={value.systemEvent}
                onChange={e => update('systemEvent', e.target.value)}
                placeholder={t('fieldSystemEventPlaceholder')}
                className={inputClass + ' min-h-[80px]'}
                rows={3}
              />
              <Hint>{t('fieldSystemEventHint')}</Hint>
            </div>
          )}

          <div>
            <FieldLabel>{t('fieldAgent')}</FieldLabel>
            <select
              value={value.agentId}
              onChange={e => update('agentId', e.target.value)}
              className={selectClass}
            >
              <option value="" className="bg-[#0a0a1a] text-white/80">{t('fieldAgentNone')}</option>
              {availableAgents.map(a => (
                <option key={a.id} value={a.id} className="bg-[#0a0a1a] text-white/80">
                  {a.name}{a.role ? ` — ${a.role}` : ''}
                </option>
              ))}
            </select>
            <Hint>{t('fieldAgentHint')}</Hint>
          </div>

          <div>
            <FieldLabel>{t('fieldModel')}</FieldLabel>
            <select
              value={value.model}
              onChange={e => update('model', e.target.value)}
              className={selectClass}
            >
              <option value="" className="bg-[#0a0a1a] text-white/80">
                {defaultModel
                  ? `${t('fieldAgentNone')} (${availableModels.find(m => m.id === defaultModel)?.name || defaultModel})`
                  : t('fieldAgentNone')}
              </option>
              {availableModels.map(m => (
                <option key={m.id} value={m.id} className="bg-[#0a0a1a] text-white/80">{m.name}</option>
              ))}
            </select>
            <Hint>{t('fieldModelHint')}</Hint>
          </div>

          <div>
            <FieldLabel>{t('fieldThinking')}</FieldLabel>
            <select
              value={value.thinking}
              onChange={e => update('thinking', e.target.value)}
              className={selectClass}
            >
              <option value="" className="bg-[#0a0a1a] text-white/80">—</option>
              <option value="off" className="bg-[#0a0a1a] text-white/80">{t('thinkingOff')}</option>
              <option value="minimal" className="bg-[#0a0a1a] text-white/80">{t('thinkingMinimal')}</option>
              <option value="low" className="bg-[#0a0a1a] text-white/80">{t('thinkingLow')}</option>
              <option value="medium" className="bg-[#0a0a1a] text-white/80">{t('thinkingMedium')}</option>
              <option value="high" className="bg-[#0a0a1a] text-white/80">{t('thinkingHigh')}</option>
              <option value="xhigh" className="bg-[#0a0a1a] text-white/80">{t('thinkingXhigh')}</option>
            </select>
            <Hint>{t('fieldThinkingHint')}</Hint>
          </div>

          <div>
            <FieldLabel>{t('fieldTimeout')}</FieldLabel>
            <Input
              type="number"
              value={value.timeoutSeconds}
              onChange={e => update('timeoutSeconds', Number(e.target.value) || 0)}
              className={inputClass}
            />
            <Hint>{t('fieldTimeoutHint')}</Hint>
          </div>
        </div>
      </div>

      {/* Divider + Section 4: 傳送設定 (only for isolated) */}
      {value.sessionTarget === 'isolated' && (
        <>
          <div className="border-t border-white/[0.06] pt-4 mt-4" />
          <div>
            <SectionHeader title={t('sectionDelivery')} description={t('sectionDeliveryDesc')} />
            <div className="space-y-3">
              <div>
                <FieldLabel>{t('deliveryMode')}</FieldLabel>
                <RadioGroup
                  value={value.deliveryMode}
                  onChange={v => update('deliveryMode', v as CronJobFormData['deliveryMode'])}
                  options={[
                    { value: 'announce', label: t('deliveryAnnounce'), description: t('deliveryAnnounceDesc') },
                    { value: 'webhook', label: t('deliveryWebhook'), description: t('deliveryWebhookDesc') },
                    { value: 'none', label: t('deliveryNone'), description: t('deliveryNoneDesc') },
                  ]}
                />
              </div>

              {value.deliveryMode === 'announce' && (
                <>
                  <div>
                    <FieldLabel>{t('fieldChannel')}</FieldLabel>
                    <Input
                      value={value.channel}
                      onChange={e => update('channel', e.target.value)}
                      placeholder="last"
                      className={inputClass}
                    />
                    <Hint>{t('fieldChannelHint')}</Hint>
                  </div>
                  <div>
                    <FieldLabel>{t('fieldTo')}</FieldLabel>
                    <Input
                      value={value.to}
                      onChange={e => update('to', e.target.value)}
                      placeholder={t('fieldToPlaceholder')}
                      className={inputClass}
                    />
                    <Hint>{t('fieldToHint')}</Hint>
                  </div>
                </>
              )}

              {value.deliveryMode === 'webhook' && (
                <div>
                  <FieldLabel>{t('fieldWebhookUrl')}</FieldLabel>
                  <Input
                    value={value.webhookUrl}
                    onChange={e => update('webhookUrl', e.target.value)}
                    placeholder={t('fieldWebhookUrlPlaceholder')}
                    className={inputClass}
                  />
                </div>
              )}

              <CheckboxField
                checked={value.bestEffort}
                onChange={v => update('bestEffort', v)}
                label={t('fieldBestEffort')}
                hint={t('fieldBestEffortHint')}
              />
            </div>
          </div>
        </>
      )}

      {/* Divider */}
      <div className="border-t border-white/[0.06] pt-4 mt-4" />

      {/* Section 5: 控制選項 */}
      <div>
        <SectionHeader title={t('sectionControl')} />
        <div className="space-y-3">
          <CheckboxField
            checked={value.enabled}
            onChange={v => update('enabled', v)}
            label={t('fieldEnabled')}
          />
          <div>
            <FieldLabel>{t('fieldWake')}</FieldLabel>
            <RadioGroup
              value={value.wake}
              onChange={v => update('wake', v as CronJobFormData['wake'])}
              options={[
                { value: 'now', label: t('wakeNow'), description: t('wakeNowDesc') },
                { value: 'next-heartbeat', label: t('wakeNextHeartbeat'), description: t('wakeNextHeartbeatDesc') },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
