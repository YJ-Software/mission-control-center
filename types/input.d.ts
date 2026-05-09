declare module 'input' {
  interface Input {
    text(prompt: string): Promise<string>
    confirm(prompt: string): Promise<boolean>
    select<T>(prompt: string, options: T[]): Promise<T>
  }
  const input: Input
  export default input
}
