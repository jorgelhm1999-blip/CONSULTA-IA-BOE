export function weekDates(weekValue, through = new Date()) {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekValue || '');
  if (!match) throw new Error('Selecciona una semana válida.');
  const year = Number(match[1]);
  const number = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  jan4.setUTCDate(jan4.getUTCDate() + (number - 1) * 7);
  const iso = date => date.toISOString().slice(0, 10);
  const thursday = new Date(jan4);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  if (number < 1 || number > 53 || Number(thursday.toISOString().slice(0, 4)) !== year) {
    throw new Error('Número de semana no válido.');
  }
  const dates = Array.from({ length: 5 }, (_, day) => {
    const date = new Date(jan4);
    date.setUTCDate(date.getUTCDate() + day);
    return iso(date);
  });
  return dates.filter(date => date <= iso(through));
}

export function isoWeek(date) {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const number = Math.ceil((((day - start) / 86400000) + 1) / 7);
  return `${year}-W${String(number).padStart(2, '0')}`;
}
