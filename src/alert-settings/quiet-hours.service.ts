import { Injectable } from '@nestjs/common';
import { MonitorAlertSettings } from '../../generated/prisma/client';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Parsed HH:MM time as total minutes since midnight. */
type MinutesSinceMidnight = number;

// ── Service ────────────────────────────────────────────────────────────────────

/**
 * Pure-logic service that determines whether the current UTC moment falls
 * inside a monitor's configured quiet window.
 *
 * All methods accept an optional `now` parameter so tests can pass a fixed
 * date without needing to mock the global Date object.
 *
 * Overnight ranges (start > end, e.g. "22:00"–"08:00") are handled
 * explicitly: quiet from 22:00 to 08:00 means quiet if time ≥ 22:00 OR
 * time < 08:00, crossing the midnight boundary.
 */
@Injectable()
export class QuietHoursService {
  /**
   * Returns true if the given moment (defaults to now) falls inside the
   * monitor's quiet window.
   *
   * Preconditions:
   *  - If quietHoursEnabled is false → always returns false.
   *  - If quietHoursStart or quietHoursEnd are absent → returns false.
   *  - If current UTC day is NOT in quietHoursDays → returns false.
   */
  isInQuietHours(settings: MonitorAlertSettings, now: Date = new Date()): boolean {
    if (!settings.quietHoursEnabled) return false;
    if (!settings.quietHoursStart || !settings.quietHoursEnd) return false;

    const currentDay = now.getUTCDay(); // 0 = Sunday … 6 = Saturday
    const days = settings.quietHoursDays as number[];

    if (!Array.isArray(days) || !days.includes(currentDay)) return false;

    const currentMins = this.toMinutes(now.getUTCHours(), now.getUTCMinutes());
    const startMins = this.parseHHMM(settings.quietHoursStart);
    const endMins = this.parseHHMM(settings.quietHoursEnd);

    return this.isInWindow(currentMins, startMins, endMins);
  }

  /**
   * Returns the next UTC DateTime when the quiet window ends and alerts
   * resume. Call only when isInQuietHours() has returned true.
   *
   * The calculation is straightforward: find today's end-time candidate;
   * if it is already in the past, advance to tomorrow.
   */
  getNextAlertTime(settings: MonitorAlertSettings, now: Date = new Date()): Date {
    if (!settings.quietHoursEnd) return now;

    const [endH, endM] = settings.quietHoursEnd.split(':').map(Number) as [number, number];

    const candidate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), endH, endM, 0, 0),
    );

    if (candidate > now) return candidate;

    // End time today is already past — alerts resume at the same time tomorrow.
    candidate.setUTCDate(candidate.getUTCDate() + 1);
    return candidate;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Determines whether `current` falls inside the window [start, end).
   *
   * Two cases:
   *   Same-day  (start < end): e.g. 14:00–18:00 → simple range check
   *   Overnight (start > end): e.g. 22:00–08:00 → wraps midnight
   *   Equal     (start = end): interpreted as "all-day quiet"
   */
  private isInWindow(
    current: MinutesSinceMidnight,
    start: MinutesSinceMidnight,
    end: MinutesSinceMidnight,
  ): boolean {
    if (start === end) return true; // full-day quiet (edge case / misconfiguration)
    if (start < end) {
      // Same-day range: e.g. 14:00–18:00
      return current >= start && current < end;
    }
    // Overnight range: e.g. 22:00–08:00 (crosses midnight)
    return current >= start || current < end;
  }

  private parseHHMM(hhmm: string): MinutesSinceMidnight {
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    return this.toMinutes(h, m);
  }

  private toMinutes(hours: number, minutes: number): MinutesSinceMidnight {
    return hours * 60 + minutes;
  }
}
