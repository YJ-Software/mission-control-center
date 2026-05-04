type Scalar = string | number | boolean

export function renderTemplate(
  source: string,
  vars: Record<string, Scalar | undefined>,
): string {
  const ESCAPE_SENTINEL = '\x00ESC\x00'
  let text = source.replace(/\\{{/g, ESCAPE_SENTINEL)
  text = text.replace(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g, (_, name: string) => {
    if (!(name in vars) || vars[name] === undefined) {
      throw new Error(`unknown placeholder: ${name}`)
    }
    const val = vars[name]
    return typeof val === 'boolean' ? String(val) : String(val)
  })
  return text.replace(new RegExp(ESCAPE_SENTINEL, 'g'), '{{')
}
