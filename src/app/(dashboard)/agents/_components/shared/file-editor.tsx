'use client'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'

export function FileEditor({
  value,
  onChange,
  readOnly,
}: {
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
}) {
  return (
    <CodeMirror
      value={value}
      height="60vh"
      extensions={[markdown()]}
      readOnly={readOnly}
      onChange={onChange}
      theme="dark"
      style={{ fontSize: 14 }}
    />
  )
}
