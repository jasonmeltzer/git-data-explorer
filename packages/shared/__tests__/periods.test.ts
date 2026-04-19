import { describe, it, expect } from 'vitest';
import { buildPeriodsFromMarker } from '../lib/periods.js';

describe('buildPeriodsFromMarker', () => {
  it('no marker returns length-1 array with label All-time', () => {
    const result = buildPeriodsFromMarker('2025-01-01', '2025-12-31', null);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('All-time');
    expect(result[0].startDate).toBe('2025-01-01');
    expect(result[0].endDate).toBe('2025-12-31');
  });

  it('no marker period has no markerDate field', () => {
    const result = buildPeriodsFromMarker('2025-01-01', '2025-12-31', null);
    expect(result[0].markerDate).toBeUndefined();
  });

  it('single marker returns length-2 array', () => {
    const result = buildPeriodsFromMarker('2025-01-01', '2025-12-31', '2025-06-01');
    expect(result).toHaveLength(2);
  });

  it('single marker produces Pre-AI and Post-AI labels', () => {
    const result = buildPeriodsFromMarker('2025-01-01', '2025-12-31', '2025-06-01');
    expect(result[0].label).toBe('Pre-AI');
    expect(result[1].label).toBe('Post-AI');
  });

  it('Pre-AI endDate is day before markerDate', () => {
    const result = buildPeriodsFromMarker('2025-01-01', '2025-12-31', '2025-06-01');
    // Day before 2025-06-01 is 2025-05-31
    expect(result[0].endDate).toBe('2025-05-31');
  });

  it('Post-AI startDate equals markerDate', () => {
    const result = buildPeriodsFromMarker('2025-01-01', '2025-12-31', '2025-06-01');
    expect(result[1].startDate).toBe('2025-06-01');
  });

  it('both periods carry markerDate field when marker is set', () => {
    const result = buildPeriodsFromMarker('2025-01-01', '2025-12-31', '2025-06-01');
    expect(result[0].markerDate).toBe('2025-06-01');
    expect(result[1].markerDate).toBe('2025-06-01');
  });

  it('Pre-AI startDate equals the provided startDate', () => {
    const result = buildPeriodsFromMarker('2025-01-01', '2025-12-31', '2025-06-01');
    expect(result[0].startDate).toBe('2025-01-01');
  });

  it('Post-AI endDate equals the provided endDate', () => {
    const result = buildPeriodsFromMarker('2025-01-01', '2025-12-31', '2025-06-01');
    expect(result[1].endDate).toBe('2025-12-31');
  });
});
