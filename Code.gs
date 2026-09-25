/**
 * Recibos de Luz — backend en Google Apps Script + Sheets + Drive.
 * Reemplaza las capacidades de claude.ai (db, assets, downloads).
 *
 * La interfaz (index.html) vive en GitHub Pages y llama a doPost con fetch; por eso la web app se
 * publica con acceso "Cualquier usuario" (anónimo) y la seguridad la pone el código de acceso
 * (ACCESS_CODE, ver login_). doGet sirve la misma interfaz como respaldo, vía google.script.run.
 *
 * Propiedades de la secuencia de comandos: ACCESS_CODE (entrar a la app) y ADMIN_PASSWORD
 * (borrar lecturas con cobros / reiniciar historiales).
 */

const SHEETS = {
  recibos: ['id','recibo','suministro','titular','tarifa','lecturaActual','lecturaAnterior','kwh','precioKwh',
    'consumoEnergia','fechaLectura','fechaLecturaAnterior','emision','corte','vencimiento','totalPagar','fose',
    'cargoFijo','mantenimiento','alumbrado','interesCompensatorio','subtotal','igv','electrificacion',
    'interesMoratorio','totalMes','ajusteAnterior','ajusteActual','deudaVencida','pagado','fechaPago',
    'pdfUrl','pdfId','pdfNombre','otrosJSON','actualizado'],
  departamentos: ['id','numero','encargado','estado','piso','lado','actualizado'],
  lecturas: ['id','deptoId','mes','lecturaAnterior','lecturaActual','kwh','montoCobrado','fechaCobro',
    'origen','fotoUrl','fotoId','historialCobroJSON','actualizado'],
  config: ['id','diaCorte','mantenimiento','actualizado'],
  tareas: ['id','hecho','fecha','actualizado'], // casillas de la hoja de ruta, compartidas entre dispositivos
};

// Columnas que deben guardarse como texto plano. Sin esto Sheets convierte "2025-12" o
// "2026-01-14" en fechas, y los ids dejan de coincidir con lo que la app espera.
const TEXT_COLS = {
  recibos: ['id','recibo','suministro','titular','tarifa','fechaLectura','fechaLecturaAnterior','emision',
    'corte','vencimiento','fechaPago','pdfUrl','pdfId','pdfNombre','otrosJSON','actualizado'],
  departamentos: ['id','encargado','estado','actualizado'],
  lecturas: ['id','deptoId','mes','fechaCobro','origen','fotoUrl','fotoId','historialCobroJSON','actualizado'],
  config: ['id','actualizado'],
  tareas: ['id','fecha','actualizado'],
};

function formatTextCols_(sh, name) {
  const headers = SHEETS[name];
  TEXT_COLS[name].forEach(col => {
    const c = headers.indexOf(col) + 1;
    if (c > 0) sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
  });
}

// ID de la Hoja de datos. Vacío = la Hoja a la que está vinculado el script.
const SPREADSHEET_ID = '1ZaOjqCeQz3IbXuEhmw0CPrFrRsO8IMCUDZXlCKGlgxs'; // "RECIBOS_JARDIN — Datos"

function getSs_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name) {
  if (!SHEETS[name]) throw new Error('unknown_collection: ' + name);
  const ss = getSs_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(SHEETS[name]);
    sh.setFrozenRows(1);
    formatTextCols_(sh, name);
  }
  return sh;
}

// google.script.run no puede devolver objetos Date (devuelve null entero), así que se normalizan.
function cellValue_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return v;
}

function rowToObj_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    const v = cellValue_(row[i]);
    if (h.endsWith('JSON')) {
      const key = h.slice(0, -4);
      try { obj[key] = v ? JSON.parse(v) : []; } catch (e) { obj[key] = []; }
    } else {
      obj[h] = (v === '' || v === undefined) ? null : v;
    }
  });
  return obj;
}

function objToRow_(headers, obj) {
  return headers.map(h => {
    if (h.endsWith('JSON')) {
      const key = h.slice(0, -4);
      return JSON.stringify(obj[key] || []);
    }
    const v = obj[h];
    if (v === undefined || v === null) return '';
    return v;
  });
}

function listCollection_(name) {
  const sh = getSheet_(name);
  const headers = SHEETS[name];
  const range = sh.getDataRange().getValues();
  if (range.length < 2) return [];
  return range.slice(1).filter(r => r[0] !== '').map(r => {
    const o = rowToObj_(headers, r);
    o.id = String(o.id);
    return o;
  });
}

function findRowIndex_(sh, id) {
  const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (let i = 1; i < ids.length; i++) {
    if (String(cellValue_(ids[i][0])) === String(id)) return i + 1;
  }
  return -1;
}

function setDoc_(collection, id, data) {
  const sh = getSheet_(collection);
  const headers = SHEETS[collection];
  const full = Object.assign({}, data, { id: id });
  const rowArr = objToRow_(headers, full);
  const idx = findRowIndex_(sh, id);
  if (idx === -1) sh.appendRow(rowArr);
  else sh.getRange(idx, 1, 1, headers.length).setValues([rowArr]);
  return full;
}

function updateDoc_(collection, id, patch) {
  const sh = getSheet_(collection);
  const headers = SHEETS[collection];
  const idx = findRowIndex_(sh, id);
  if (idx === -1) throw new Error('not_found: ' + collection + '/' + id);
  const current = rowToObj_(headers, sh.getRange(idx, 1, 1, headers.length).getValues()[0]);
  const merged = Object.assign({}, current, patch, { id: id });
  sh.getRange(idx, 1, 1, headers.length).setValues([objToRow_(headers, merged)]);
  return merged;
}

function deleteDoc_(collection, id) {
  const sh = getSheet_(collection);
  const idx = findRowIndex_(sh, id);
  if (idx > -1) sh.deleteRow(idx);
  return { deleted: true };
}

// Carpeta raíz en Drive. Dentro: "Recibos PDF" y "Fotos medidores/Depto N" (historial de fotos por departamento).
const ROOT_FOLDER_NAME = 'RECIBOS_JARDIN';
const ROOT_FOLDER_ID = '1UzM3j6YR8ZBkT2Ol4NM_Gst3wAT8x22C'; // carpeta creada en tu Drive; si no existe, se busca por nombre

function getRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const rootId = props.getProperty('ROOT_FOLDER_ID') || ROOT_FOLDER_ID;
  if (rootId) {
    try { return DriveApp.getFolderById(rootId); } catch (e) {}
  }
  const it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
  props.setProperty('ROOT_FOLDER_ID', folder.getId());
  return folder;
}

function getSubfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function getFolder_(carpeta) {
  let folder = getRootFolder_();
  (carpeta || []).forEach(name => {
    const limpio = String(name).replace(/[\/\\]/g, '-').trim();
    if (limpio) folder = getSubfolder_(folder, limpio);
  });
  return folder;
}

function uploadFile_(base64Data, mimeType, filename, carpeta) {
  const folder = getFolder_(carpeta);
  const bytes = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(bytes, mimeType, filename || 'archivo');
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const isImage = (mimeType || '').indexOf('image/') === 0;
  const url = isImage
    ? ('https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600')
    : file.getUrl();
  return { id: file.getId(), url: url, viewUrl: file.getUrl() };
}

/* ---------- Recordatorio mensual de lecturas (Google Calendar) ----------
 * Un evento que se repite cada mes en el calendario del dueño del script, con aviso en el celular.
 * El día y la hora se guardan en Propiedades (RECORDATORIO_DIA / _HORA / _SERIE_ID).
 * La primera vez hay que autorizar Calendar: ejecutar crearRecordatorioMedidores() desde el editor. */
const RECORDATORIO_TITULO = '📷 Tomar fotos de los medidores — Recibos Jardín';
const APP_URL = 'https://argonzn.github.io/recibos-jardin/';

function conPermisoCalendar_(fn) {
  try { return fn(); } catch (e) {
    if (/permis|autoriz|authoriz|scope/i.test(String(e && e.message))) throw new Error('falta_permiso_calendar');
    throw e;
  }
}

function estadoRecordatorio_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('RECORDATORIO_SERIE_ID');
  const dia = Number(p.getProperty('RECORDATORIO_DIA') || 12);
  const hora = Number(p.getProperty('RECORDATORIO_HORA') || 9);
  // Sin serie guardada no se toca Calendar, así la app funciona aunque falte el permiso.
  const activo = id ? conPermisoCalendar_(() => !!CalendarApp.getEventSeriesById(id)) : false;
  return { activo: activo, dia: dia, hora: hora };
}

function quitarRecordatorio_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('RECORDATORIO_SERIE_ID');
  if (id) conPermisoCalendar_(() => { const s = CalendarApp.getEventSeriesById(id); if (s) s.deleteEventSeries(); });
  p.deleteProperty('RECORDATORIO_SERIE_ID');
  return estadoRecordatorio_();
}

function crearRecordatorio_(dia, hora) {
  dia = Math.round(Number(dia)); hora = Math.round(Number(hora));
  if (!(dia >= 1 && dia <= 28)) throw new Error('dia_invalido'); // hasta 28 para que exista en todos los meses
  if (!(hora >= 6 && hora <= 21)) throw new Error('hora_invalida');
  return conPermisoCalendar_(() => {
    quitarRecordatorio_();
    const ahora = new Date();
    let inicio = new Date(ahora.getFullYear(), ahora.getMonth(), dia, hora, 0, 0);
    if (inicio <= ahora) inicio = new Date(ahora.getFullYear(), ahora.getMonth() + 1, dia, hora, 0, 0);
    const fin = new Date(inicio.getTime() + 30 * 60 * 1000);
    const serie = CalendarApp.getDefaultCalendar().createEventSeries(
      RECORDATORIO_TITULO, inicio, fin,
      CalendarApp.newRecurrence().addMonthlyRule().onlyOnMonthDay(dia),
      { description: 'Toma la foto del medidor de cada departamento activo y regístrala en la app:\n' + APP_URL +
          '\n\nDeptos → departamento → Agregar lectura → Tomar/subir foto.' });
    serie.removeAllReminders();
    serie.addPopupReminder(0);
    const p = PropertiesService.getScriptProperties();
    p.setProperty('RECORDATORIO_SERIE_ID', serie.getId());
    p.setProperty('RECORDATORIO_DIA', String(dia));
    p.setProperty('RECORDATORIO_HORA', String(hora));
    return estadoRecordatorio_();
  });
}

/** Ejecutar desde el editor para autorizar Calendar y crear el recordatorio el día 12 a las 9:00 (el día se cambia luego desde la app). */
function crearRecordatorioMedidores() {
  const p = PropertiesService.getScriptProperties();
  const r = crearRecordatorio_(12, p.getProperty('RECORDATORIO_HORA') || 9);
  console.log('Recordatorio creado: día ' + r.dia + ' de cada mes a las ' + r.hora + ':00.');
}

// Enlaces a la Hoja, Drive y el editor: se entregan solo con token, para no publicarlos en el código de la web.
function infoProyecto_() {
  const id = ScriptApp.getScriptId();
  return {
    hoja: getSs_().getUrl(),
    carpeta: getRootFolder_().getUrl(),
    recibosPdf: getFolder_(['Recibos PDF']).getUrl(),
    fotos: getFolder_(['Fotos medidores']).getUrl(),
    editor: 'https://script.google.com/d/' + id + '/edit',
    propiedades: 'https://script.google.com/home/projects/' + id + '/settings',
  };
}

/* ---------- Vincular PDF dejados en Drive ----------
 * Revisa RECIBOS_JARDIN/Recibos PDF y enlaza cada PDF con el recibo de su mes, deducido del nombre:
 * "Recibo 2026-03.pdf", "MAR26.pdf", "JUN26 (2).pdf", "SET-2026.pdf"… Así basta con arrastrar los PDF a la carpeta. */
const MESES_PDF_ = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12 };

function mesDesdeNombre_(nombre) {
  const n = String(nombre).toUpperCase();
  let m = n.match(/(20\d{2})[-_ .]?(0[1-9]|1[0-2])(?!\d)/);
  if (m) return m[1] + '-' + m[2];
  m = n.match(/(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SET|OCT|NOV|DIC)[A-Z]*[-_ .]*((?:20)?\d{2})(?!\d)/);
  if (m) {
    const anio = m[2].length === 2 ? '20' + m[2] : m[2];
    return anio + '-' + ('0' + MESES_PDF_[m[1]]).slice(-2);
  }
  return null;
}

function vincularPdfs_() {
  const carpeta = getFolder_(['Recibos PDF']);
  const recibos = listCollection_('recibos');
  const porMes = {};
  recibos.forEach(r => { porMes[r.id] = r; });
  const res = { vinculados: [], yaEstaban: [], sinRecibo: [], noReconocidos: [] };
  const it = carpeta.getFilesByType(MimeType.PDF);
  while (it.hasNext()) {
    const f = it.next();
    const mes = mesDesdeNombre_(f.getName());
    if (!mes) { res.noReconocidos.push(f.getName()); continue; }
    const r = porMes[mes];
    if (!r) { res.sinRecibo.push(f.getName() + ' → ' + mes); continue; }
    if (r.pdfId === f.getId()) { res.yaEstaban.push(mes); continue; }
    if (r.pdfId) { res.yaEstaban.push(mes + ' (ya tenía otro PDF; no se cambió)'); continue; }
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const original = f.getName();
    f.setName('Recibo ' + mes + '.pdf');
    updateDoc_('recibos', mes, { pdfId: f.getId(), pdfUrl: f.getUrl(), pdfNombre: original, actualizado: new Date().toISOString() });
    r.pdfId = f.getId();
    res.vinculados.push(mes);
  }
  return res;
}

function deleteFile_(fileId) {
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
  return { deleted: true };
}

/* ---------- Código de acceso a la app ----------
 * La interfaz vive en GitHub Pages y llama a esta API sin sesión de Google, así que toda petición
 * debe traer un token. El token es HMAC(ACCESS_CODE): no revela el código y, si cambias ACCESS_CODE
 * en Propiedades de la secuencia de comandos, todos los tokens anteriores dejan de valer. */
function tokenEsperado_() {
  const codigo = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE') || '';
  if (!codigo) throw new Error('sin_codigo_acceso');
  const firma = Utilities.computeHmacSha256Signature('recibos-jardin-v1', codigo);
  return firma.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function login_(codigo) {
  const cache = CacheService.getScriptCache();
  const fallos = Number(cache.get('fallos_login') || 0);
  if (fallos >= 10) throw new Error('demasiados_intentos'); // 10 intentos fallidos → bloqueo de 10 minutos
  const real = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE') || '';
  if (!real) throw new Error('sin_codigo_acceso');
  if (String(codigo || '') !== real) {
    cache.put('fallos_login', String(fallos + 1), 600);
    throw new Error('codigo_incorrecto');
  }
  cache.remove('fallos_login');
  return { token: tokenEsperado_() };
}

function exigirToken_(token) {
  if (!token || String(token) !== tokenEsperado_()) throw new Error('no_autorizado');
}

/* ---------- Contraseña de administrador ----------
 * Se guarda en Configuración del proyecto → Propiedades de la secuencia de comandos → ADMIN_PASSWORD.
 * Nunca llega al navegador: el servidor la compara y bloquea las operaciones protegidas sin ella. */
function verificarClave_(clave) {
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || '';
  if (!real) throw new Error('sin_clave_admin');
  const cache = CacheService.getScriptCache();
  const fallos = Number(cache.get('fallos_admin') || 0);
  if (fallos >= 5) throw new Error('demasiados_intentos'); // 5 intentos fallidos → bloqueo de 10 minutos
  if (String(clave || '') !== real) {
    cache.put('fallos_admin', String(fallos + 1), 600);
    throw new Error('clave_incorrecta');
  }
  cache.remove('fallos_admin');
}

function getDoc_(collection, id) {
  const sh = getSheet_(collection);
  const idx = findRowIndex_(sh, id);
  if (idx === -1) return null;
  return rowToObj_(SHEETS[collection], sh.getRange(idx, 1, 1, SHEETS[collection].length).getValues()[0]);
}

// Protegido: borrar una lectura con cobros registrados, o quitar entradas de su historial de cobro.
function requiereClave_(body) {
  if (body.collection !== 'lecturas') return false;
  const actual = getDoc_('lecturas', body.id);
  if (!actual) return false;
  const histActual = (actual.historialCobro || []).length;
  if (body.action === 'delete') return actual.montoCobrado != null || histActual > 0;
  if (body.action === 'set' || (body.action === 'update' && body.data && 'historialCobro' in body.data)) {
    return ((body.data && body.data.historialCobro) || []).length < histActual;
  }
  return false;
}

/** Punto de entrada único: lo usan google.script.run (desde index.html) y doGet/doPost. */
function api(body) {
  if (body.action === 'login') return login_(body.codigo);
  exigirToken_(body.token);
  switch (body.action) {
    case 'ping':    return { ok: true };
    case 'list':    return listCollection_(body.collection);
    case 'listAll': {
      const out = {};
      (body.collections || []).forEach(c => { out[c] = listCollection_(c); });
      return out;
    }
    case 'verificarClave': verificarClave_(body.clave); return { ok: true };
    case 'info':    return infoProyecto_();
    case 'recordatorio':
      if (body.op === 'crear') return crearRecordatorio_(body.dia, body.hora);
      if (body.op === 'quitar') return quitarRecordatorio_();
      return estadoRecordatorio_();
  }
  // Escrituras con bloqueo para que dos personas guardando a la vez no se pisen.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (requiereClave_(body)) verificarClave_(body.clave);
    switch (body.action) {
      case 'set':        return setDoc_(body.collection, body.id, body.data);
      case 'update':     return updateDoc_(body.collection, body.id, body.data);
      case 'delete':     return deleteDoc_(body.collection, body.id);
      case 'upload':     return uploadFile_(body.base64, body.mimeType, body.filename, body.carpeta);
      case 'deleteFile': return deleteFile_(body.fileId);
      case 'vincularPdfs': return vincularPdfs_();
      default: throw new Error('unknown_action: ' + body.action);
    }
  } finally {
    lock.releaseLock();
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// La app principal está en GitHub Pages; esta copia servida por Google queda como respaldo (también pide el código).
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Recibos de luz')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) {
    return jsonOut_({ ok: false, error: 'bad_json' });
  }
  try {
    return jsonOut_({ ok: true, result: api(body) });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

/** Ejecuta esto UNA vez desde el editor: crea las pestañas y carga los datos de Datos.gs. */
function setup() {
  const ss = getSs_();
  const csvs = { recibos: CSV_RECIBOS, departamentos: CSV_DEPARTAMENTOS, lecturas: CSV_LECTURAS, config: CSV_CONFIG };
  Object.keys(SHEETS).forEach(name => {
    const sh = getSheet_(name);
    if (sh.getLastRow() > 1) return; // ya tiene datos: no se toca
    const headers = SHEETS[name];
    formatTextCols_(sh, name);
    const rows = Utilities.parseCsv(csvs[name].trim());
    const csvHeaders = rows[0];
    const data = rows.slice(1).filter(r => r[0] !== '').map(r => headers.map(h => {
      const raw = r[csvHeaders.indexOf(h)];
      if (raw === undefined || raw === '') return '';
      if (TEXT_COLS[name].indexOf(h) > -1) return raw;
      if (raw === 'TRUE') return true;
      if (raw === 'FALSE') return false;
      const n = Number(raw);
      return isNaN(n) ? raw : n;
    }));
    if (data.length) sh.getRange(2, 1, data.length, headers.length).setValues(data);
  });
  // Borra la "Hoja 1" vacía que trae toda hoja nueva
  const hoja1 = ss.getSheets().find(s => !SHEETS[s.getName()] && s.getLastRow() === 0);
  if (hoja1 && ss.getSheets().length > 1) ss.deleteSheet(hoja1);
  const sinClave = !PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (sinClave) console.warn('Falta la contraseña de administrador: agrégala como ADMIN_PASSWORD en Configuración del proyecto → Propiedades de la secuencia de comandos.');
  ss.toast(sinClave ? 'Datos cargados. Falta definir ADMIN_PASSWORD (ver instrucciones).' : 'Listo: pestañas creadas y datos cargados.');
}
