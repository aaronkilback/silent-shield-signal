import { describe, it, expect } from 'vitest';
import { formatMinutesToDHM, formatMinutesToDHMFull } from '@/lib/timeUtils';

describe('formatMinutesToDHM', () => {
  it('returns "0m" for zero minutes', () => {
    expect(formatMinutesToDHM(0)).toBe('0m');
  });

  it('formats minutes only', () => {
    expect(formatMinutesToDHM(45)).toBe('45m');
  });

  it('formats hours and minutes', () => {
    expect(formatMinutesToDHM(90)).toBe('1h 30m');
  });

  it('formats exactly one hour', () => {
    expect(formatMinutesToDHM(60)).toBe('1h');
  });

  it('formats days, hours, and minutes', () => {
    expect(formatMinutesToDHM(1505)).toBe('1d 1h 5m');
  });

  it('formats exactly one day', () => {
    expect(formatMinutesToDHM(1440)).toBe('1d');
  });

  it('formats multiple days', () => {
    expect(formatMinutesToDHM(2880)).toBe('2d');
  });

  it('handles large values', () => {
    expect(formatMinutesToDHM(10081)).toBe('7d 1m');
  });
});

describe('formatMinutesToDHMFull', () => {
  it('returns "0 minutes" for zero', () => {
    expect(formatMinutesToDHMFull(0)).toBe('0 minutes');
  });

  it('formats singular minute', () => {
    expect(formatMinutesToDHMFull(1)).toBe('1 minute');
  });

  it('formats plural minutes', () => {
    expect(formatMinutesToDHMFull(5)).toBe('5 minutes');
  });

  it('formats singular hour', () => {
    expect(formatMinutesToDHMFull(60)).toBe('1 hour');
  });

  it('formats plural hours with minutes', () => {
    expect(formatMinutesToDHMFull(150)).toBe('2 hours 30 minutes');
  });

  it('formats singular day', () => {
    expect(formatMinutesToDHMFull(1440)).toBe('1 day');
  });

  it('formats plural days with hours and minutes', () => {
    expect(formatMinutesToDHMFull(2705)).toBe('1 day 21 hours 5 minutes');
  });
});
