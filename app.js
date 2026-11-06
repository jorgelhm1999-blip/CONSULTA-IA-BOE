import { collectBulletin } from './lib/query-client.js';
import { MUNICIPALITIES } from './municipalities.js';
import { initHistoricalSearch } from './historical-ui.js';
import { isoWeek, weekDates } from './lib/week.js';

const $ = selector => document.querySelector(selector);
const dateInput = $('#date');
const municipalityInput = $('#municipality');
const municipalityList = $('#municipality-list');
const searchButton = $('#search');
const status = $('#status');
const results = $('#results');
const searchIndicator = $('#bocmi-search-indicator');


const todayParts = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
}).formatToParts(new Date());
const todayPart = name => todayParts.find(part => part.type === name).value;
dateInput.value = isoWeek(new Date(Number(todayPart('year')), Number(todayPart('month')) - 1, Number(todayPart('day'))));
municipalityList.innerHTML = MUNICIPALITIES.map(name => `<option value="${name}"></option>`).join('');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function cveNumber(cve = '') {
  return Number(String(cve).split('-').pop()) || 0;
}

function officialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['boe.es', 'www.boe.es'].includes(url.hostname)
      ? url.href : '';
  } catch { return ''; }
}

function renderCard(item) {
  const tags = (item.matches || []).map(tag => `<span class="badge">${escapeHtml(tag)}</span>`).join('');
  const level = item.decision === 'principal' ? 'Interés principal' : item.decision === 'complementario' ? 'Interés complementario' : 'Revisión recomendada';
  const heading = item.cve || 'Anuncio BOE';
  const url = officialUrl(item.url);
  return `<article class="card">
    <div class="badges"><span class="badge high">${level}</span>${item.publicationDate ? `<span class="badge date-badge">${escapeHtml(item.publicationDate.split('-').reverse().join('/'))}</span>` : ''}${tags}</div>
    <h2>${escapeHtml(heading)}</h2>
    <p class="announcement-title">${escapeHtml(item.title || '')}</p>
    ${item.summary ? `<p class="ai-summary">${escapeHtml(item.summary)}</p>` : ''}
    ${item.reason ? `<p class="reason"><strong>Motivo de selección:</strong> ${escapeHtml(item.reason)}</p>` : ''}
    ${url ? `<div class="actions"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir anuncio en HTML</a></div>` : ''}
  </article>`;
}

function setLoading(text) {
  results.innerHTML = '';
  status.innerHTML = `<span class="spinner"></span>${text}`;
}

function renderReport(report) {
  const groups = [
    ['Publicaciones de interés principal', report.principal],
    ['Avisos complementarios', report.complementary],
    ['Revisión recomendada', report.doubtful]
  ];
  const html = groups.filter(([, items]) => items.length).map(([title, items]) =>
    `<section class="result-group"><h2 class="group-title">${title}</h2>${items.map(renderCard).join('')}</section>`).join('');
  results.innerHTML = html || '<div class="empty">Todavía no hay resultados seleccionados.</div>';
}

async function runSearch() {
  if (!dateInput.value || searchButton.disabled) return;
  let dates;
  try {
    const today = new Date(`${todayPart('year')}-${todayPart('month')}-${todayPart('day')}T12:00:00Z`);
    dates = weekDates(dateInput.value, today);
    if (!dates.length) throw new Error('La semana seleccionada aún no ha comenzado.');
  } catch (error) { status.textContent = error.message; return; }
  const dateLabel = `${dates[0].split('-').reverse().join('/')}–${dates.at(-1).split('-').reverse().join('/')}`;
  searchButton.disabled = true;
  dateInput.disabled = true;
  municipalityInput.disabled = true;
  searchIndicator.hidden = false;
  const startedAt = Date.now();
  let activityMessage = `Preparando la semana ${dateLabel}`;
  const activityTimer = setInterval(() => {
    status.textContent = `${activityMessage} · en curso (${Math.floor((Date.now() - startedAt) / 1000)} s)`;
  }, 1000);
  setLoading(`Preparando la semana ${dateLabel}…`);
  try {
    const weekly = { principal: [], complementary: [], doubtful: [], total: 0, scanned: 0, aiCacheHits: 0, failedCves: [] };
    let publishedDays = 0;
    for (const [index, day] of dates.entries()) {
      const dayLabel = day.split('-').reverse().join('/');
      activityMessage = `Día ${index + 1} de ${dates.length} (${dayLabel}) · leyendo sumario`;
      let report;
      try {
        report = await collectBulletin(location.origin, day, {
          municipality: municipalityInput.value.trim(),
          onProgress(progress) {
            const phase = progress.phase === 'download' ? 'descargando textos' : 'revisando anuncios';
            activityMessage = `Día ${index + 1} de ${dates.length} (${dayLabel}) · ${phase}: ${progress.downloaded}/${progress.total} descargados · ${progress.scanned} revisados`;
            status.textContent = activityMessage;
            renderReport({ ...weekly, principal: [...weekly.principal, ...progress.principal], complementary: [...weekly.complementary, ...progress.complementary], doubtful: [...weekly.doubtful, ...progress.doubtful] });
          }
        });
      } catch (error) {
        if (!error.partialReport) throw error;
        report = error.partialReport;
        weekly.failedCves.push(`${dayLabel}: ${error.message}`);
      }
      if (report.found) publishedDays++;
      for (const key of ['principal', 'complementary', 'doubtful']) {
        weekly[key].push(...(report[key] || []).map(item => ({ ...item, publicationDate: day })));
      }
      weekly.total += report.total || 0;
      weekly.scanned += report.scanned || 0;
      weekly.aiCacheHits += report.aiCacheHits || 0;
      weekly.failedCves.push(...(report.failedCves || []));
      renderReport(weekly);
    }
    const incomplete = weekly.failedCves.length;
    status.textContent = `Semana ${dateLabel} · ${publishedDays} boletines · ${weekly.scanned} anuncios revisados de ${weekly.total} publicados · ${weekly.aiCacheHits} análisis reutilizados.${incomplete ? ` Consulta parcial: ${incomplete} pendientes (${weekly.failedCves.join(', ')}).` : ' Consulta completa.'}`;
    if (!incomplete && !weekly.principal.length && !weekly.complementary.length && !weekly.doubtful.length) {
      results.innerHTML = '<div class="empty">No se han detectado publicaciones de interés en los anuncios revisados.</div>';
    }
  } catch (error) {
    if (error.partialReport) renderReport(error.partialReport);
    const counts = error.partialReport ? ` ${error.partialReport.scanned}/${error.partialReport.total} anuncios revisados.` : '';
    const hasResults = error.partialReport && ['principal', 'complementary', 'doubtful'].some(key => error.partialReport[key]?.length);
    status.textContent = `${dateLabel} · ${error.message}${counts}${hasResults ? ' Consulta parcial: se conservan los resultados ya recibidos.' : ' No se ha completado la consulta de esta semana.'}`;
    if (!error.partialReport) results.innerHTML = '<div class="empty">No se ha podido obtener el sumario oficial. Puedes reintentar o consultar otra fecha.</div>';
  } finally {
    clearInterval(activityTimer);
    searchIndicator.hidden = true;
    searchButton.disabled = false;
    dateInput.disabled = false;
    municipalityInput.disabled = false;
  }
}

dateInput.addEventListener('change', () => {
  if (searchButton.disabled) return;
  results.innerHTML = '';
  status.textContent = 'Semana cambiada. Pulsa Analizar semana para iniciar una nueva búsqueda.';
});

searchButton.addEventListener('click', runSearch);
municipalityInput.addEventListener('keydown', event => { if (event.key === 'Enter') runSearch(); });

initHistoricalSearch();

