import type { ScheduleConfig, HourlyConfig, DailyConfig, WeeklyConfig, MonthlyConfig } from '@/lib/backup/helpers'

/**
 * Calculate the next scheduled run time strictly after the given time.
 * All computation in local time; results have seconds and milliseconds = 0.
 */
export function nextRunAt(type: string, config: ScheduleConfig, after: Date): Date {
  const result = new Date(after)
  result.setSeconds(0, 0) // seconds and milliseconds to 0

  if (type === 'hourly') {
    const c = config as HourlyConfig
    // Start from next minute
    result.setMinutes(0)
    result.setHours(result.getHours() + 1)

    // Find next hour where hour % interval === 0
    while (result.getHours() % c.interval !== 0) {
      result.setHours(result.getHours() + 1)
    }

    return result
  }

  if (type === 'daily') {
    const c = config as DailyConfig
    const [hh, mm] = c.time.split(':').map(Number)

    // Try today at the specified time
    result.setHours(hh, mm, 0, 0)

    // If that time has already passed today, move to tomorrow
    if (result <= after) {
      result.setDate(result.getDate() + 1)
    }

    // Find the next day that's in the days list
    while (!c.days.includes(result.getDay())) {
      result.setDate(result.getDate() + 1)
    }

    return result
  }

  if (type === 'weekly') {
    const c = config as WeeklyConfig
    const [hh, mm] = c.time.split(':').map(Number)

    result.setHours(hh, mm, 0, 0)

    // Move to the target weekday
    const targetDay = c.day
    const currentDay = result.getDay()

    let daysAhead = targetDay - currentDay
    if (daysAhead < 0) {
      // Target day already happened this week, move to next week
      daysAhead += 7
    } else if (daysAhead === 0) {
      // Same day - check if the time has passed
      if (result <= after) {
        daysAhead = 7 // Move to next week
      }
    }

    result.setDate(result.getDate() + daysAhead)
    result.setHours(hh, mm, 0, 0)

    return result
  }

  if (type === 'monthly') {
    const c = config as MonthlyConfig
    const [hh, mm] = c.time.split(':').map(Number)

    result.setDate(c.dayOfMonth)
    result.setHours(hh, mm, 0, 0)

    // If that date/time has passed, move to next month
    if (result <= after) {
      result.setMonth(result.getMonth() + 1)
      result.setDate(c.dayOfMonth)
      result.setHours(hh, mm, 0, 0)
    }

    return result
  }

  throw new Error(`Unknown schedule type: ${type}`)
}

/**
 * Check if a backup is due: nextRunAt(type, config, lastTick) <= now
 */
export function isDue(type: string, config: ScheduleConfig, lastTick: Date, now: Date): boolean {
  const nextRun = nextRunAt(type, config, lastTick)
  return nextRun <= now
}
