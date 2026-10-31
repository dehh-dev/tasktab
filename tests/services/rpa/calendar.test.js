'use strict';

const {
  addDays,
  isoWeekday,
  daysBetween,
  eachDate,
  latest,
  earliest,
} = require('../../../src/services/rpa/calendar');

describe('calendar', () => {
  it.each([
    ['2026-10-12', 1],
    ['2026-10-13', 2],
    ['2026-10-17', 6],
    ['2026-10-18', 7],
  ])('%s e o dia ISO %i', (date, weekday) => {
    expect(isoWeekday(date)).toBe(weekday);
  });

  it.each([
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-03-01', -1, '2026-02-28'],
    // O horario de verao nao existe mais, mas a conta em UTC nao dependeria dele.
    ['2026-10-17', 2, '2026-10-19'],
  ])('%s %+i dia = %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });

  it('percorre o periodo com as duas pontas', () => {
    expect(eachDate('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(eachDate('2026-10-30', '2026-10-30')).toEqual(['2026-10-30']);
    expect(eachDate('2026-10-31', '2026-10-30')).toEqual([]);
  });

  it('conta os dias com as duas pontas', () => {
    expect(daysBetween('2026-10-13', '2026-11-30')).toBe(49);
    expect(daysBetween('2026-10-13', '2026-10-13')).toBe(1);
  });

  it('o maior inicio e o menor fim ignoram o lado sem limite', () => {
    expect(latest('2026-10-13', null, '2026-10-15')).toBe('2026-10-15');
    expect(earliest('2026-11-30', undefined, '2026-11-20')).toBe('2026-11-20');
    expect(earliest(null)).toBeNull();
  });
});
