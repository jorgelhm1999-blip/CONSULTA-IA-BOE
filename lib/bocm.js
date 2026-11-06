import { cacheGet, cacheSet, singleFlight } from './bocm-cache.js';
import * as cheerio from 'cheerio';
import { analyzeBocmRecords, analyzeBocmChunk } from './gemini-bocm.js';
import { findLiteralMatch, matchingExcerpt } from './historical-match.js';
const BASE = 'https://www.boe.es';
const normalize = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];

async function resource(url, accept) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: accept }, signal: AbortSignal.timeout(12000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`BOE respondió HTTP ${response.status}`);
      return await response.text();
    } catch (error) { last = error; }
  }
  throw new Error(`No se pudo leer el BOE: ${last?.message || 'error temporal'}`);
}

export function parseBoeManifest(payload, date) {
  if (String(payload.status?.code) !== '200') throw new Error('El BOE no confirmó el sumario solicitado.');
  const summary = payload.data?.sumario;
  if (summary?.metadatos?.fecha_publicacion !== date.replaceAll('-', '')) throw new Error('La fecha del sumario no coincide.');
  const entries = [];
  function walk(node, context = {}) {
    if (Array.isArray(node)) { node.forEach(child => walk(child, context)); return; }
    if (!node || typeof node !== 'object') return;
    if (/^BOE-[AB]-[0-9]{4}-[0-9]+$/.test(node.identificador || '')) {
      entries.push({ cve: node.identificador, title: node.titulo || '', ...context });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'seccion' || key === 'departamento') {
        array(value).forEach(child => walk(child, { ...context, [key === 'seccion' ? 'section' : 'department']: child.nombre || '' }));
      } else if (typeof value === 'object') walk(value, context);
    }
  }
  walk(summary.diario);
  const cves = [...new Set(entries.map(item => item.cve))];
  if (!cves.length) throw new Error('El sumario no contiene disposiciones o anuncios reconocibles.');
  return { found: true, cves, entries, bulletinNumber: array(summary.diario).map(day => day.numero).join(', '),
    bulletinUrl: `${BASE}/boe/dias/${date.replaceAll('-', '/')}/`,
    summaryXmlUrl: `${BASE}/datosabiertos/api/boe/sumario/${date.replaceAll('-', '')}` };
}

export async function getBocmManifest(date) {
  return singleFlight(`manifest:${date}`, async () => {
    const cached = await cacheGet(`manifest:${date}`);
    if (cached?.found) return cached;
    const text = await resource(`${BASE}/datosabiertos/api/boe/sumario/${date.replaceAll('-', '')}`, 'application/json');
    if (text === null) return { found: false, cves: [], bulletinNumber: '', bulletinUrl: '' };
    const manifest = parseBoeManifest(JSON.parse(text), date);
    await cacheSet(`manifest:${date}`, manifest, 300);
    return manifest;
  });
}

export function parseXmlRecord(xml, cve) {
  const $ = cheerio.load(xml || '', { xmlMode: true });
  const text = selector => $(selector).first().text().replace(/\s+/g, ' ').trim();
  if (text('metadatos > identificador') !== cve || !text('documento > texto')) return null;
  return { cve, title: text('metadatos > titulo'), body: text('documento > texto'),
    section: text('metadatos > seccion'), department: text('metadatos > departamento'), organization: '',
    htmlUrl: `${BASE}/diario_boe/txt.php?id=${cve}`, bulletinNumber: text('metadatos > diario_numero'),
    publicationDate: text('metadatos > fecha_publicacion') };
}

export async function fetchXmlRecordDetailed(cve) {
  if (!/^BOE-[AB]-[0-9]{4}-[0-9]+$/.test(cve)) return { status: 'not_found', record: null };
  return singleFlight(`source:${cve}`, async () => {
    const cached = await cacheGet(`source:${cve}`);
    if (cached?.body) return { status: 'ok', record: cached, cached: true };
    try {
      const xml = await resource(`${BASE}/diario_boe/xml.php?id=${cve}`, 'application/xml');
      const record = parseXmlRecord(xml, cve);
      if (!record) return { status: xml === null ? 'not_found' : 'transient', record: null };
      await cacheSet(`source:${cve}`, record, 86400);
      return { status: 'ok', record };
    } catch { return { status: 'transient', record: null }; }
  });
}

export async function downloadBocmBatch(cves) {
  const items = await mapConcurrent(cves, 4, async cve => ({ cve, ...await fetchXmlRecordDetailed(cve) }));
  return { downloadedCves: items.filter(item => item.record).map(item => item.cve),
    failedCves: items.filter(item => !item.record).map(item => item.cve), cacheHits: items.filter(item => item.cached).length };
}
function cveNumber(cve) { return Number(cve.split('-').pop()) || 0; }

function municipalityFromRecord(record) {
  if (normalize(record.section).includes('administracion local') && record.organization) {
    return record.organization.replace(/\s+/g, ' ').trim();
  }
  const titleMatch = record.title.match(/^[-–—]?\s*([^.]+)\.\s*Urbanismo\b/i);
  if (titleMatch) return titleMatch[1].trim();
  return 'Ámbito autonómico o no identificado';
}

function cleanBody(record) {
  let body = String(record.body || '').replace(/\s+/g, ' ').trim();
  const title = String(record.title || '').replace(/^[-–—]\s*/, '').trim();
  if (title) {
    const pos = normalize(body).indexOf(normalize(title));
    if (pos >= 0) body = body.slice(Math.min(body.length, pos + title.length)).trim();
  }
  body = body
    .replace(/^I{1,3}\.\s+COMUNIDAD DE MADRID\s*/i, '')
    .replace(/^III\.\s+ADMINISTRACIÓN LOCAL\s*/i, '')
    .replace(/^AYUNTAMIENTO DE\s+[^.]{2,100}\s*/i, '')
    .replace(/^URBANISMO\s*/i, '')
    .replace(/^\d+\s*/, '')
    .trim();
  return body;
}

function buildSummary(record) {
  const body = cleanBody(record);
  if (!body) return record.title;
  const sentences = body.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [body];
  const useful = sentences
    .map(value => value.trim())
    .filter(value => value.length >= 45)
    .slice(0, 2)
    .join(' ');
  return (useful || body).slice(0, 620);
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function searchBocmCveBatch(date, municipalityText = '', cveValues = [], { cachedOnly = false } = {}) {
  const compact = String(date || '').replaceAll('-', '');
  const manifest = await getBocmManifest(date);
  const allowed = new Set(manifest.cves);
  const cves = [...new Set((Array.isArray(cveValues) ? cveValues : [])
    .map(value => String(value || '').trim().toUpperCase())
    .filter(value => /^BOE-[AB]-[0-9]{4}-[0-9]+$/.test(value))
  )].filter(cve => allowed.has(cve)).slice(0, 24);

  const fetched = await mapConcurrent(cves, Math.min(4, cves.length), async cve => {
    const record = cachedOnly ? await cacheGet(`source:${cve}`) : null;
    const item = cachedOnly ? { status: record?.body ? 'ok' : 'transient', record } : await fetchXmlRecordDetailed(cve);
    return { cve, ...item };
  });

  const records = [];
  let missingCount = 0;
  let transientCount = 0;
  for (const item of fetched) {
    if (item.status === 'not_found') { missingCount += 1; continue; }
    if (item.status !== 'ok' || !item.record) { transientCount += 1; continue; }
    records.push(item.record);
  }

  const analysis = await analyzeBocmChunk(records);
  const decisions = analysis.decisions;
  const decisionMap = new Map(decisions.map(item => [item.cve, item]));
  const municipalityFilter = normalize(municipalityText);
  const results = [];
  const complementary = [];
  const doubtful = [];
  let excludedCount = 0;

  for (const record of records) {
    const ai = decisionMap.get(record.cve);
    if (!ai) continue;
    if (ai.decision === 'excluir') { excludedCount += 1; continue; }

    const municipality = ai.municipio || municipalityFromRecord(record);
    if (municipalityFilter) {
      const haystack = normalize(`${municipality} ${record.title} ${record.body} ${record.organization}`);
      if (!haystack.includes(municipalityFilter)) continue;
    }

    const output = {
      cve: record.cve,
      title: record.title || record.cve,
      municipality,
      summary: ai.resumen || buildSummary(record),
      url: record.htmlUrl,
      score: ai.decision === 'principal' ? 100 : ai.decision === 'complementario' ? 70 : 50,
      reason: ai.motivo || '',
      object: ai.objeto_real || '',
      directRelation: Boolean(ai.relacion_directa),
      matches: ai.categoria ? [ai.categoria] : [],
      category: ai.categoria || 'Sin clasificar',
      decision: ai.decision,
      section: record.section,
      department: record.department || record.organization
    };

    if (ai.decision === 'principal') results.push(output);
    else if (ai.decision === 'complementario') complementary.push(output);
    else doubtful.push(output);
  }

  const sortCve = (a, b) => cveNumber(a.cve) - cveNumber(b.cve);
  results.sort(sortCve);
  complementary.sort(sortCve);
  doubtful.sort(sortCve);

  const failedCves = fetched.filter(item => item.status !== 'ok' || !item.record).map(item => item.cve);
  return {
    existingCount: decisions.length,
    processedCves: decisions.map(item => item.cve),
    pendingCves: analysis.pendingCves,
    analysisError: analysis.error || null,
    metrics: analysis.metrics,
    missingCount,
    transientCount,
    excludedCount,
    failedCves,
    results,
    complementary,
    doubtful
  };
}

// La revisión opcional aplica a las coincidencias el mismo clasificador de
// dos etapas que utiliza la consulta diaria.
export async function searchHistoricalCveBatch(date, query, municipalityText = '', cveValues = [], relevanceFilter = false) {
  const compact = date.replaceAll('-', '');
  const manifest = await getBocmManifest(date);
  const allowed = new Set(manifest.cves);
  const cves = [...new Set(cveValues.map(value => String(value).toUpperCase()))]
    .filter(cve => /^BOE-[AB]-[0-9]{4}-[0-9]+$/.test(cve))
    .filter(cve => allowed.has(cve)).slice(0, 12);
  const fetched = await mapConcurrent(cves, 3, async cve => ({
    cve,
    ...await fetchXmlRecordDetailed(cve, { timeoutMs: 7500, attempts: 1 })
  }));
  const results = [];
  const matchedRecords = [];
  const failedCves = [];
  const failedDetails = [];
  let existingCount = 0;
  const municipalityFilter = normalize(municipalityText);

  for (const item of fetched) {
    if (item.status !== 'ok' || !item.record) {
      failedCves.push(item.cve);
      failedDetails.push({ cve: item.cve, reason: item.status === 'not_found' ? 'not_found' : 'transient' });
      continue;
    }
    existingCount += 1;
    const record = item.record;
    const municipality = municipalityFromRecord(record);
    if (municipalityFilter && !normalize(`${municipality} ${record.organization} ${record.title} ${record.body}`)
      .includes(municipalityFilter)) continue;

    const fields = [
      ['Texto del anuncio', record.body],
      ['Título', record.title],
      ['Organismo', record.organization],
      ['Departamento', record.department],
      ['Sección', record.section]
    ];
    const candidates = query ? fields : [
      ['Municipio', municipality], ['Organismo', record.organization],
      ['Título', record.title], ['Texto del anuncio', record.body]
    ];
    for (const [source, content] of candidates) {
      const match = findLiteralMatch(content, query || municipalityText);
      if (!match) continue;
      const result = {
        date,
        cve: record.cve,
        title: record.title || record.cve,
        department: record.department,
        organization: record.organization,
        municipality: municipality === 'Ámbito autonómico o no identificado' ? '' : municipality,
        url: record.htmlUrl,
        source,
        excerpt: matchingExcerpt(content, match)
      };
      results.push(result);
      matchedRecords.push(record);
      break;
    }
  }

  if (relevanceFilter && matchedRecords.length) {
    let decisions;
    try {
      decisions = await analyzeBocmRecords(matchedRecords);
    } catch (error) {
      error.isHistoricalRelevanceError = true;
      throw error;
    }
    const byCve = new Map(decisions.map(item => [item.cve, item]));
    const selected = results.flatMap(result => {
      const ai = byCve.get(result.cve);
      if (!ai || !['principal', 'complementario'].includes(ai.decision)) return [];
      return [{
        ...result,
        municipality: ai.municipio || result.municipality,
        decision: ai.decision,
        category: ai.categoria || '',
        summary: ai.resumen || '',
        reason: ai.motivo || ''
      }];
    });
    return { existingCount, failedCves, failedDetails, results: selected };
  }

  return { existingCount, failedCves, failedDetails, results };
}

