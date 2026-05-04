'use client'

import { useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Textarea } from '@/components/ui/textarea'
import { Code2 } from 'lucide-react'

const DEFAULT_VARIABLES = [
  'TODAY',
  'DATE_HYPHEN',
  'YEAR',
  'TMP_DIR',
  'LANGUAGE',
  'TOPIC_NAME',
  'TOPIC_EMOJI',
  'TOPIC_INDEX',
  'TOPIC_TOTAL',
  'OUTPUT_FILE',
]

interface TemplateEditorProps {
  value: string
  onChange: (value: string) => void
  variables?: string[]
  placeholder?: string
  rows?: number
  variableFormat?: 'dollar' | 'mustache'
}

export function TemplateEditor({
  value,
  onChange,
  variables = DEFAULT_VARIABLES,
  placeholder,
  rows = 12,
  variableFormat = 'dollar',
}: TemplateEditorProps) {
  const t = useTranslations('morningReport')
  const resolvedPlaceholder = placeholder ?? t('templateEditor.placeholder')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const insertVariable = useCallback(
    (varName: string) => {
      const el = textareaRef.current
      const insertion = variableFormat === 'mustache' ? `{{${varName}}}` : `\${${varName}}`
      if (!el) {
        onChange(value + insertion)
        return
      }
      const start = el.selectionStart
      const end = el.selectionEnd
      const newValue = value.slice(0, start) + insertion + value.slice(end)
      onChange(newValue)
      // Restore cursor position after the inserted variable
      requestAnimationFrame(() => {
        el.focus()
        const newPos = start + insertion.length
        el.setSelectionRange(newPos, newPos)
      })
    },
    [value, onChange, variableFormat]
  )

  return (
    <div className="space-y-2">
      {/* Variable hints */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Code2 className="w-3 h-3 text-white/25 shrink-0" />
        {variables.map(v => (
          <button
            key={v}
            type="button"
            onClick={() => insertVariable(v)}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-400/10 text-cyan-400/70
              hover:bg-cyan-400/20 hover:text-cyan-400 transition-colors border border-cyan-400/10
              hover:border-cyan-400/25"
          >
            {variableFormat === 'mustache' ? '{{' + v + '}}' : '${' + v + '}'}
          </button>
        ))}
      </div>

      {/* Textarea */}
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={resolvedPlaceholder}
        rows={rows}
        className="font-mono text-xs bg-white/[0.03] border-white/[0.08] text-white/80
          placeholder:text-white/20 focus-visible:ring-cyan-400/30 resize-y min-h-[120px]"
      />
    </div>
  )
}
