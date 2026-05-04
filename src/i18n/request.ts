import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'

const locales = ['zh-TW', 'zh-CN', 'en']
const defaultLocale = 'zh-TW'

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const localeCookie = cookieStore.get('locale')?.value
  const locale = locales.includes(localeCookie || '') ? (localeCookie as string) : defaultLocale

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
