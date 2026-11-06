import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekDates, isoWeek } from '../lib/week.js';

test('semanas solicitadas: lunes a viernes sin fin de semana', () => {
  assert.deepEqual(weekDates('2026-W44', new Date('2026-11-07')), ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30']);
  assert.deepEqual(weekDates('2026-W45', new Date('2026-11-07')), ['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06']);
  assert.equal(isoWeek(new Date(2026,10,6)), '2026-W45');
});
test('semana actual solo analiza fechas transcurridas', () => {
  assert.deepEqual(weekDates('2026-W45', new Date('2026-11-04T12:00:00Z')), ['2026-11-02','2026-11-03','2026-11-04']);
  assert.throws(() => weekDates('2026-W54'));
});
