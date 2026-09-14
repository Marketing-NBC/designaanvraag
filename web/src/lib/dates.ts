import { addBusinessDays, differenceInBusinessDays, format, parseISO, startOfDay } from 'date-fns'
import { nl } from 'date-fns/locale'

/** Vandaag als ISO-datum (YYYY-MM-DD) in lokale tijd. */
export function todayIso(now: Date = new Date()): string {
  return toIso(startOfDay(now))
}

export function toIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromIso(iso: string): Date {
  return parseISO(iso)
}

/** "woensdag 14 oktober 2026" */
export function formatLong(iso: string): string {
  return format(fromIso(iso), 'EEEE d MMMM yyyy', { locale: nl })
}

/** "14 okt 2026" */
export function formatShort(iso: string): string {
  return format(fromIso(iso), 'd MMM yyyy', { locale: nl })
}

/** Eerste datum die minimaal `days` werkdagen na `from` ligt. */
export function earliestComfortableDeadline(days: number, from: Date = new Date()): string {
  return toIso(addBusinessDays(startOfDay(from), days))
}

/** Aantal werkdagen (ma–vr) tussen vandaag en de deadline; negatief als de deadline al voorbij is. */
export function businessDaysUntil(deadlineIso: string, from: Date = new Date()): number {
  return differenceInBusinessDays(fromIso(deadlineIso), startOfDay(from))
}

export function isBeforeToday(iso: string, from: Date = new Date()): boolean {
  return iso < todayIso(from)
}
