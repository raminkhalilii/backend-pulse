import { MonitorAlertSettings } from '../../generated/prisma/client';
import { QuietHoursService } from './quiet-hours.service';

// ── Test-double factory ────────────────────────────────────────────────────────

function makeSettings(overrides: Partial<MonitorAlertSettings> = {}): MonitorAlertSettings {
  return {
    id: 'settings-1',
    monitorId: 'monitor-1',
    alertThreshold: 2,
    escalationThreshold: 5,
    alertOnRecovery: true,
    quietHoursEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
    quietHoursDays: [0, 1, 2, 3, 4, 5, 6] as unknown as MonitorAlertSettings['quietHoursDays'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Returns a Date set to the given UTC hour:minute on a specific weekday (Sun=0). */
function utcDate(day: number, hour: number, minute: number): Date {
  // 2026-04-13 is a Monday (day=1). Adjust from there.
  // Using a known Monday reference: 2026-04-13T00:00:00Z is day=1.
  // We compute offset in days to land on the right weekday.
  const base = new Date('2026-04-13T00:00:00Z'); // Monday
  const dayOffset = (day - 1 + 7) % 7; // offset from Monday
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('QuietHoursService', () => {
  let service: QuietHoursService;

  beforeEach(() => {
    service = new QuietHoursService();
  });

  // ── isInQuietHours ─────────────────────────────────────────────────────────

  describe('isInQuietHours', () => {
    it('returns false immediately when quietHoursEnabled is false', () => {
      const settings = makeSettings({ quietHoursEnabled: false });
      const now = utcDate(1, 23, 0); // Monday 23:00 — deep inside a 22:00–08:00 window
      expect(service.isInQuietHours(settings, now)).toBe(false);
    });

    it('returns false when quietHoursStart is null', () => {
      const settings = makeSettings({ quietHoursStart: null });
      expect(service.isInQuietHours(settings, utcDate(1, 23, 0))).toBe(false);
    });

    it('returns false when quietHoursEnd is null', () => {
      const settings = makeSettings({ quietHoursEnd: null });
      expect(service.isInQuietHours(settings, utcDate(1, 23, 0))).toBe(false);
    });

    // ── Overnight range (22:00–08:00) ───────────────────────────────────────

    it('returns true at 22:00 exactly — start of overnight window', () => {
      const settings = makeSettings({ quietHoursStart: '22:00', quietHoursEnd: '08:00' });
      expect(service.isInQuietHours(settings, utcDate(1, 22, 0))).toBe(true);
    });

    it('returns true at 23:30 — inside overnight window (before midnight)', () => {
      const settings = makeSettings({ quietHoursStart: '22:00', quietHoursEnd: '08:00' });
      expect(service.isInQuietHours(settings, utcDate(1, 23, 30))).toBe(true);
    });

    it('returns true at 00:00 — inside overnight window (after midnight)', () => {
      const settings = makeSettings({ quietHoursStart: '22:00', quietHoursEnd: '08:00' });
      expect(service.isInQuietHours(settings, utcDate(1, 0, 0))).toBe(true);
    });

    it('returns true at 07:59 — last minute inside overnight window', () => {
      const settings = makeSettings({ quietHoursStart: '22:00', quietHoursEnd: '08:00' });
      expect(service.isInQuietHours(settings, utcDate(1, 7, 59))).toBe(true);
    });

    it('returns false at 08:00 exactly — window has just ended', () => {
      const settings = makeSettings({ quietHoursStart: '22:00', quietHoursEnd: '08:00' });
      expect(service.isInQuietHours(settings, utcDate(1, 8, 0))).toBe(false);
    });

    it('returns false at 12:00 — outside overnight window', () => {
      const settings = makeSettings({ quietHoursStart: '22:00', quietHoursEnd: '08:00' });
      expect(service.isInQuietHours(settings, utcDate(1, 12, 0))).toBe(false);
    });

    it('returns false at 21:59 — one minute before overnight window starts', () => {
      const settings = makeSettings({ quietHoursStart: '22:00', quietHoursEnd: '08:00' });
      expect(service.isInQuietHours(settings, utcDate(1, 21, 59))).toBe(false);
    });

    // ── Same-day range (14:00–18:00) ────────────────────────────────────────

    it('returns true at 14:00 — start of same-day window', () => {
      const settings = makeSettings({ quietHoursStart: '14:00', quietHoursEnd: '18:00' });
      expect(service.isInQuietHours(settings, utcDate(1, 14, 0))).toBe(true);
    });

    it('returns true at 16:30 — inside same-day window', () => {
      const settings = makeSettings({ quietHoursStart: '14:00', quietHoursEnd: '18:00' });
      expect(service.isInQuietHours(settings, utcDate(1, 16, 30))).toBe(true);
    });

    it('returns false at 18:00 exactly — same-day window has ended', () => {
      const settings = makeSettings({ quietHoursStart: '14:00', quietHoursEnd: '18:00' });
      expect(service.isInQuietHours(settings, utcDate(1, 18, 0))).toBe(false);
    });

    it('returns false at 13:59 — one minute before same-day window', () => {
      const settings = makeSettings({ quietHoursStart: '14:00', quietHoursEnd: '18:00' });
      expect(service.isInQuietHours(settings, utcDate(1, 13, 59))).toBe(false);
    });

    it('returns false at 09:00 — completely outside same-day window', () => {
      const settings = makeSettings({ quietHoursStart: '14:00', quietHoursEnd: '18:00' });
      expect(service.isInQuietHours(settings, utcDate(1, 9, 0))).toBe(false);
    });

    // ── quietHoursDays filtering ─────────────────────────────────────────────

    it('returns false when the current day is NOT in quietHoursDays', () => {
      // Only weekdays (Mon–Fri = 1–5), checking on Sunday (0)
      const settings = makeSettings({
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        quietHoursDays: [1, 2, 3, 4, 5] as unknown as MonitorAlertSettings['quietHoursDays'],
      });
      const sunday = utcDate(0, 23, 0); // Sunday 23:00 — inside the time window
      expect(service.isInQuietHours(settings, sunday)).toBe(false);
    });

    it('returns true when the current day IS in quietHoursDays', () => {
      const settings = makeSettings({
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        quietHoursDays: [1, 2, 3, 4, 5] as unknown as MonitorAlertSettings['quietHoursDays'],
      });
      const wednesday = utcDate(3, 23, 30); // Wednesday 23:30 — inside window
      expect(service.isInQuietHours(settings, wednesday)).toBe(true);
    });

    it('returns false when quietHoursDays is an empty array', () => {
      const settings = makeSettings({
        quietHoursDays: [] as unknown as MonitorAlertSettings['quietHoursDays'],
      });
      expect(service.isInQuietHours(settings, utcDate(1, 23, 0))).toBe(false);
    });
  });

  // ── getNextAlertTime ───────────────────────────────────────────────────────

  describe('getNextAlertTime', () => {
    it('returns today at 08:00 UTC when quiet hours end at 08:00 and it is 03:00 UTC', () => {
      const settings = makeSettings({ quietHoursEnd: '08:00' });
      const now = utcDate(1, 3, 0); // 03:00 UTC — end time is still ahead today

      const result = service.getNextAlertTime(settings, now);

      expect(result.getUTCHours()).toBe(8);
      expect(result.getUTCMinutes()).toBe(0);
      expect(result.getUTCDate()).toBe(now.getUTCDate());
    });

    it('returns tomorrow at 08:00 UTC when 08:00 today has already passed (now is 12:00)', () => {
      const settings = makeSettings({ quietHoursEnd: '08:00' });
      const now = utcDate(1, 12, 0); // 12:00 UTC — end time already passed today

      const result = service.getNextAlertTime(settings, now);

      expect(result.getUTCHours()).toBe(8);
      expect(result.getUTCMinutes()).toBe(0);
      // Should be tomorrow
      expect(result.getUTCDate()).toBe(now.getUTCDate() + 1);
    });

    it('returns now when quietHoursEnd is null', () => {
      const settings = makeSettings({ quietHoursEnd: null });
      const now = utcDate(1, 10, 0);
      const result = service.getNextAlertTime(settings, now);
      expect(result).toBe(now);
    });

    it('preserves seconds=0 and milliseconds=0 in the returned Date', () => {
      const settings = makeSettings({ quietHoursEnd: '06:30' });
      const now = utcDate(1, 3, 0);

      const result = service.getNextAlertTime(settings, now);

      expect(result.getUTCSeconds()).toBe(0);
      expect(result.getUTCMilliseconds()).toBe(0);
    });
  });
});
