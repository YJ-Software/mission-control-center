import type { ScheduleConfig, HourlyConfig, DailyConfig, WeeklyConfig, MonthlyConfig } from '@/lib/backup/helpers'

// Validation: time format HH:MM where HH is 0-23, MM is 0-59
const TIME_REGEX = /^([01]?\d|2[0-3]):[0-5]\d$/

function validateTime(time: string, field: string): void {
  if (!TIME_REGEX.test(time)) {
    throw new Error(`Invalid time format for ${field}: "${time}". Expected HH:MM (00:00–23:59).`)
  }
}

/**
 * Calculate the next scheduled run time strictly after the given time.
 * All computation in local time; results have seconds and milliseconds = 0.
 */
export function nextRunAt(type: string, config: ScheduleConfig, after: Date): Date {
  const result = new Date(after)
  result.setSeconds(0, 0) // seconds and milliseconds to 0

  if (type === 'hourly') {
    const c = config as HourlyConfig

    // Validate interval
    if (!Number.isInteger(c.interval) || c.interval < 1) {
      throw new Error(`Invalid hourly interval: ${c.interval}. Must be an integer >= 1.`)
    }

    // Start from next minute
    result.setMinutes(0)
    result.setHours(result.getHours() + 1)

    // Find next hour where hour % interval === 0 (bounded to avoid infinite loop)
    const maxSteps = 24 * c.interval + 1
    for (let step = 0; step < maxSteps; step++) {
      if (result.getHours() % c.interval === 0) {
        return result
      }
      result.setHours(result.getHours() + 1)
    }

    throw new Error(`Hourly interval ${c.interval} iteration exceeded ${maxSteps} steps`)
  }

  if (type === 'daily') {
    const c = config as DailyConfig

    // Validate days array
    if (!Array.isArray(c.days) || c.days.length === 0) {
      throw new Error(`Invalid daily days: must be a non-empty array of integers 0–6.`)
    }
    if (!c.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
      throw new Error(`Invalid daily days: all values must be integers 0–6, got ${JSON.stringify(c.days)}.`)
    }

    // Validate time format
    validateTime(c.time, 'daily time')
    const [hh, mm] = c.time.split(':').map(Number)

    // Try today at the specified time
    result.setHours(hh, mm, 0, 0)

    // If that time has already passed today, move to tomorrow
    if (result <= after) {
      result.setDate(result.getDate() + 1)
    }

    // Find the next day that's in the days list (bounded to avoid infinite loop)
    const maxSteps = 8 // At most 7 days to find a match, +1 safety margin
    for (let step = 0; step < maxSteps; step++) {
      if (c.days.includes(result.getDay())) {
        return result
      }
      result.setDate(result.getDate() + 1)
    }

    throw new Error(`Daily schedule iteration exceeded ${maxSteps} days without finding a match`)
  }

  if (type === 'weekly') {
    const c = config as WeeklyConfig

    // Validate day
    if (!Number.isInteger(c.day) || c.day < 0 || c.day > 6) {
      throw new Error(`Invalid weekly day: ${c.day}. Must be an integer 0–6 (Sun–Sat).`)
    }

    // Validate time format
    validateTime(c.time, 'weekly time')
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

    // Validate dayOfMonth (limited to 1–28 so month rollover is always valid)
    if (!Number.isInteger(c.dayOfMonth) || c.dayOfMonth < 1 || c.dayOfMonth > 28) {
      throw new Error(`Invalid monthly dayOfMonth: ${c.dayOfMonth}. Must be an integer 1–28.`)
    }

    // Validate time format
    validateTime(c.time, 'monthly time')
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
