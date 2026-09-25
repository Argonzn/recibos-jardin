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
  // agua: 'medidor' | 'sin_medidor' | 'no'. Las columnas nuevas van al final (ver asegurarEncabezados_).
  departamentos: ['id','numero','encargado','estado','piso','lado','actualizado','agua','telefono'],
  lecturas: ['id','deptoId','mes','lecturaAnterior','lecturaActual','kwh','montoCobrado','fechaCobro',
    'origen','fotoUrl','fotoId','historialCobroJSON','actualizado'],
  // mantenimiento = administración de luz (S/ por depto). admAgua y mantExtra se agregaron con el módulo de agua.
  config: ['id','diaCorte','mantenimiento','actualizado','admAgua','mantExtra','baseSinMedidor'],
  tareas: ['id','hecho','fecha','actualizado'], // casillas de la hoja de ruta, compartidas entre dispositivos
  // Agua (Sedapal): un recibo por mes facturado. atraso = mora + (cierre + reapertura) con IGV.
  agua_recibos: ['id','recibo','suministro','emision','vencimiento','periodoInicio','periodoFin','lecturaAnterior',
    'lecturaActual','m3','volumen','alcantarillado','cargoFijo','cierre','reapertura','mora','igv','redondeoAnterior',
    'redondeoActual','total','pagado','fechaPago','pdfUrl','pdfId','pdfNombre','responsablesAtrasoJSON','otrosJSON','actualizado'],
  // Lecturas de agua del día 12. deptoId 'general' = medidor de Sedapal leído por nosotros.
  lecturas_agua: ['id','deptoId','mes','lecturaAnterior','lecturaActual','m3','origen','fotoUrl','fotoId','actualizado'],
  // Cargos del mes por depto (si falta el mes, se usan los de config).
  // base = m³ del mes para los deptos sin medidor (cada mes guarda la suya).
  cargos: ['id','admLuz','admAgua','mant','actualizado','base'],
  // Cobro único por depto y mes (luz + agua + administración + mantenimiento + atrasos).
  // pagoTarde: true = pagó fuera de fecha (le toca parte de la mora/corte/reapertura del agua del mes siguiente),
  // false = a tiempo, vacío = se decide por la fecha de cobro.
  cobros: ['id','deptoId','mes','montoCobrado','fechaCobro','nota','historialCobroJSON','actualizado','pagoTarde','tipoPago'],
};

// Columnas que deben guardarse como texto plano. Sin esto Sheets convierte "2025-12" o
// "2026-01-14" en fechas, y los ids dejan de coincidir con lo que la app espera.
const TEXT_COLS = {
  recibos: ['id','recibo','suministro','titular','tarifa','fechaLectura','fechaLecturaAnterior','emision',
    'corte','vencimiento','fechaPago','pdfUrl','pdfId','pdfNombre','otrosJSON','actualizado'],
  departamentos: ['id','encargado','estado','actualizado','agua','telefono'],
  lecturas: ['id','deptoId','mes','fechaCobro','origen','fotoUrl','fotoId','historialCobroJSON','actualizado'],
  config: ['id','actualizado'],
  tareas: ['id','fecha','actualizado'],
  agua_recibos: ['id','recibo','suministro','emision','vencimiento','periodoInicio','periodoFin','fechaPago',
    'pdfUrl','pdfId','pdfNombre','responsablesAtrasoJSON','otrosJSON','actualizado'],
  lecturas_agua: ['id','deptoId','mes','origen','fotoUrl','fotoId','actualizado'],
  cargos: ['id','actualizado'],
  cobros: ['id','deptoId','mes','fechaCobro','nota','historialCobroJSON','actualizado','tipoPago'],
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

// Se abre UNA vez por ejecución: abrir la Hoja es de lo más lento que hace el script.
let ssCache_ = null;
function getSs_() {
  if (!ssCache_) ssCache_ = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  return ssCache_;
}

const hojasRevisadas_ = {}; // por ejecución: evita revisar encabezados en cada llamada

function getSheet_(name) {
  if (!SHEETS[name]) throw new Error('unknown_collection: ' + name);
  const ss = getSs_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(SHEETS[name]);
    sh.setFrozenRows(1);
    formatTextCols_(sh, name);
  } else if (!hojasRevisadas_[name]) {
    asegurarEncabezados_(sh, name);
  }
  hojasRevisadas_[name] = true;
  return sh;
}

// Migración: si SHEETS ganó columnas nuevas al final, se agregan sus encabezados (y formato de texto)
// sin tocar los datos. Solo se permite agregar al final: el orden de las columnas existentes no cambia.
function asegurarEncabezados_(sh, name) {
  const headers = SHEETS[name];
  // Ya revisada en las últimas 6 h con esta misma cantidad de columnas: no se vuelve a consultar la Hoja.
  const cache = CacheService.getScriptCache(), clave = 'enc_' + name;
  if (cache.get(clave) === String(headers.length)) return;
  const actuales = sh.getLastColumn();
  if (actuales >= headers.length) { cache.put(clave, String(headers.length), 21600); return; }
  const faltan = headers.slice(actuales);
  sh.getRange(1, actuales + 1, 1, faltan.length).setValues([faltan]);
  faltan.forEach((col, i) => {
    if (TEXT_COLS[name].indexOf(col) > -1) sh.getRange(1, actuales + 1 + i, sh.getMaxRows(), 1).setNumberFormat('@');
  });
}

// Zona horaria de la Hoja: Sheets interpreta "2026-02" como fecha en SU zona, no en la del script.
let tzHoja_ = null;
function zonaHoja_() {
  if (!tzHoja_) { try { tzHoja_ = getSs_().getSpreadsheetTimeZone(); } catch (e) { tzHoja_ = Session.getScriptTimeZone(); } }
  return tzHoja_;
}
const esFecha_ = v => Object.prototype.toString.call(v) === "[object Date]";
const COLS_MES_ = ['id', 'mes']; // columnas que guardan un mes AAAA-MM

// google.script.run no puede devolver objetos Date (devuelve null entero), así que se normalizan.
// Si Sheets convirtió un texto en fecha, se recupera tal cual se escribió ("2026-02" o "2026-02-10").
function cellValue_(v, col) {
  if (esFecha_(v)) {
    // Las filas agregadas por el script guardan la fecha a medianoche UTC; las escritas a mano, en la zona de la Hoja.
    const utc = v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0;
    const iso = Utilities.formatDate(v, utc ? 'UTC' : zonaHoja_(), 'yyyy-MM-dd');
    if (COLS_MES_.indexOf(col) > -1 && iso.slice(8) === '01') return iso.slice(0, 7);
    return iso;
  }
  return v;
}

// Formato de texto en las columnas de texto de UNA fila, justo antes de escribirla: sin esto Sheets
// convierte "2026-02" en fecha al agregar filas nuevas.
function formatoTextoFila_(sh, name, fila) {
  const headers = SHEETS[name];
  const a1 = TEXT_COLS[name].map(col => headers.indexOf(col) + 1).filter(c => c > 0)
    .map(c => sh.getRange(fila, c).getA1Notation());
  if (a1.length) sh.getRangeList(a1).setNumberFormat('@');
}

// Reparación única: pasa a texto las celdas de columnas de texto que Sheets había convertido en fecha.
function repararTextos_() {
  Object.keys(SHEETS).forEach(name => {
    const sh = getSs_().getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const headers = SHEETS[name];
    TEXT_COLS[name].forEach(col => {
      const c = headers.indexOf(col) + 1;
      if (c < 1 || c > sh.getLastColumn()) return;
      const rango = sh.getRange(2, c, sh.getLastRow() - 1, 1);
      const vals = rango.getValues();
      if (!vals.some(r => esFecha_(r[0]))) return;
      rango.setNumberFormat('@');
      rango.setValues(vals.map(r => [esFecha_(r[0]) ? cellValue_(r[0], col) : r[0]]));
    });
  });
}

function rowToObj_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    const v = cellValue_(row[i], h);
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
    if (String(cellValue_(ids[i][0], 'id')) === String(id)) return i + 1;
  }
  return -1;
}

function setDoc_(collection, id, data) {
  const sh = getSheet_(collection);
  const headers = SHEETS[collection];
  const full = Object.assign({}, data, { id: id });
  const rowArr = objToRow_(headers, full);
  let idx = findRowIndex_(sh, id);
  if (idx === -1) idx = sh.getLastRow() + 1; // no se usa appendRow: convierte textos como "2026-02" en fechas
  formatoTextoFila_(sh, collection, idx);
  sh.getRange(idx, 1, 1, headers.length).setValues([rowArr]);
  return full;
}

function updateDoc_(collection, id, patch) {
  const sh = getSheet_(collection);
  const headers = SHEETS[collection];
  const idx = findRowIndex_(sh, id);
  if (idx === -1) throw new Error('not_found: ' + collection + '/' + id);
  const current = rowToObj_(headers, sh.getRange(idx, 1, 1, headers.length).getValues()[0]);
  const merged = Object.assign({}, current, patch, { id: id });
  formatoTextoFila_(sh, collection, idx);
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
      { description: 'Toma la foto de los medidores de LUZ y de AGUA de cada departamento, y la del medidor ' +
          'general de agua (Sedapal). Regístralas en la app:\n' + APP_URL +
          '\n\nLuz y agua: Deptos → departamento → Lecturas.\nMedidor general de agua: pestaña Agua.' });
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

// tipo 'luz' → Recibos PDF + pestaña recibos; 'agua' → Recibos agua PDF + pestaña agua_recibos.
const TIPOS_PDF_ = { luz: { carpeta: 'Recibos PDF', coleccion: 'recibos', prefijo: 'Recibo ' },
                     agua: { carpeta: 'Recibos agua PDF', coleccion: 'agua_recibos', prefijo: 'Agua ' } };

function vincularPdfs_(tipo) {
  const t = TIPOS_PDF_[tipo] || TIPOS_PDF_.luz;
  const carpeta = getFolder_([t.carpeta]);
  const recibos = listCollection_(t.coleccion);
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
    f.setName(t.prefijo + mes + '.pdf');
    updateDoc_(t.coleccion, mes, { pdfId: f.getId(), pdfUrl: f.getUrl(), pdfNombre: original, actualizado: new Date().toISOString() });
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
function firmaHex_(texto, clave) {
  return Utilities.computeHmacSha256Signature(texto, clave).map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
function tokenEsperado_() {
  const codigo = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE') || '';
  if (!codigo) throw new Error('sin_codigo_acceso');
  return firmaHex_('recibos-jardin-v1', codigo);
}

/* Acceso de inquilino: cada depto puede tener su propio código (Propiedad COD_INQ_<depto>). Su token solo permite
 * LEER, y el servidor filtra los datos: ve sus cobros y sus fotos, no los montos ni nombres de los demás. */
function codigosInquilino_() {
  const todas = PropertiesService.getScriptProperties().getProperties(), out = {};
  Object.keys(todas).forEach(k => { if (k.indexOf('COD_INQ_') === 0) out[k.slice(8)] = todas[k]; });
  return out;
}
const tokenInquilino_ = (dep, codigo) => 'inq.' + dep + '.' + firmaHex_('recibos-jardin-inq|' + dep, codigo);

function login_(codigo) {
  const cache = CacheService.getScriptCache();
  const fallos = Number(cache.get('fallos_login') || 0);
  if (fallos >= 10) throw new Error('demasiados_intentos'); // 10 intentos fallidos → bloqueo de 10 minutos
  const c = String(codigo || '');
  const real = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE') || '';
  if (real && c === real) { cache.remove('fallos_login'); return { token: tokenEsperado_(), rol: 'admin' }; }
  const inq = codigosInquilino_();
  const dep = Object.keys(inq).find(d => inq[d] && inq[d] === c.toUpperCase().trim());
  if (dep) { cache.remove('fallos_login'); return { token: tokenInquilino_(dep, inq[dep]), rol: 'inquilino', depto: dep }; }
  if (!real) throw new Error('sin_codigo_acceso');
  cache.put('fallos_login', String(fallos + 1), 600);
  throw new Error('codigo_incorrecto');
}

// Devuelve quién llama: {rol:'admin'} o {rol:'inquilino', depto}.
function exigirToken_(token) {
  const t = String(token || '');
  if (t.indexOf('inq.') === 0) {
    const dep = t.split('.')[1];
    const codigo = PropertiesService.getScriptProperties().getProperty('COD_INQ_' + dep);
    if (codigo && t === tokenInquilino_(dep, codigo)) return { rol: 'inquilino', depto: dep };
    throw new Error('no_autorizado');
  }
  if (!t || t !== tokenEsperado_()) throw new Error('no_autorizado');
  return { rol: 'admin' };
}

function apiInquilino_(body, dep) {
  if (body.action === 'ping') return { ok: true, rol: 'inquilino', depto: dep };
  if (body.action !== 'listAll') throw new Error('solo_lectura');
  const permitidas = ['recibos', 'departamentos', 'lecturas', 'config', 'agua_recibos', 'lecturas_agua', 'cobros', 'cargos'];
  const out = {};
  (body.collections || []).filter(c => permitidas.indexOf(c) > -1).forEach(c => {
    let docs = listCollection_(c);
    // De los demás solo se sabe si pagaron y si fue a tiempo (decide a quién le toca el atraso del agua), sin montos.
    if (c === 'cobros') docs = docs.map(x => x.deptoId === dep ? x : {
      id: x.id, deptoId: x.deptoId, mes: x.mes, montoCobrado: x.montoCobrado != null && x.montoCobrado !== '' ? 0 : null,
      fechaCobro: x.fechaCobro, pagoTarde: x.pagoTarde, tipoPago: x.tipoPago === 'parcial' ? 'parcial' : '', nota: '', historialCobro: [] });
    if (c === 'departamentos') docs = docs.map(x => x.id === dep ? x : Object.assign({}, x, { encargado: '', telefono: '' }));
    if (c === 'lecturas' || c === 'lecturas_agua') docs = docs.map(x => x.deptoId === dep ? x :
      Object.assign({}, x, { fotoUrl: null, fotoId: null, montoCobrado: x.montoCobrado != null && x.montoCobrado !== '' ? 0 : null, fechaCobro: null, historialCobro: [] }));
    out[c] = docs;
  });
  return out;
}

// Administración de los códigos de inquilino (solo el administrador).
function codigoInquilino_(dep, op) {
  if (!/^dep_[\w]+$/.test(String(dep || ''))) throw new Error('depto_invalido');
  const p = PropertiesService.getScriptProperties(), k = 'COD_INQ_' + dep;
  if (op === 'quitar') { p.deleteProperty(k); return { codigo: null }; }
  if (op === 'generar') {
    const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para que no se confundan
    let codigo = '';
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + dep + Date.now());
    for (let i = 0; i < 6; i++) codigo += letras[(bytes[i] & 0xff) % letras.length];
    p.setProperty(k, codigo);
    return { codigo: codigo };
  }
  return { codigo: p.getProperty(k) };
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

// Protegido: borrar una lectura o un cobro con pagos registrados, o quitar entradas de su historial de cobro.
function requiereClave_(body) {
  if (body.collection !== 'lecturas' && body.collection !== 'cobros') return false;
  const actual = getDoc_(body.collection, body.id);
  if (!actual) return false;
  const histActual = (actual.historialCobro || []).length;
  if (body.action === 'delete') return actual.montoCobrado != null || histActual > 0;
  if (body.action === 'set' || (body.action === 'update' && body.data && 'historialCobro' in body.data)) {
    return ((body.data && body.data.historialCobro) || []).length < histActual;
  }
  return false;
}

function repararTextosUnaVez_() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('TEXTOS_REPARADOS_V1') && p.getProperty('DESFASE_REPARADO_V2')) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return; // otra ejecución la está haciendo
  try {
    if (!p.getProperty('TEXTOS_REPARADOS_V1')) { repararTextos_(); p.setProperty('TEXTOS_REPARADOS_V1', new Date().toISOString()); }
    if (!p.getProperty('DESFASE_REPARADO_V2')) { repararDesfase_(); p.setProperty('DESFASE_REPARADO_V2', new Date().toISOString()); }
  } finally { lock.releaseLock(); }
}

// La reparación V1 leyó con la zona equivocada y dejó los meses como el último día del mes anterior
// ("2026-01-31" en vez de "2026-02") y las fechas de esas filas un día antes. Esto lo revierte.
// Solo toca filas cuyo mes tiene la forma dañada; las que ya están bien ("2026-02") no cambian.
const COLS_FECHA_DESFASE_ = { agua_recibos: ['emision','vencimiento','periodoInicio','periodoFin','fechaPago'], cobros: ['fechaCobro'] };
function sumarDia_(iso) { const [y, m, d] = iso.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + 1)); return Utilities.formatDate(x, 'UTC', 'yyyy-MM-dd'); }
function mesDesfasado_(v) {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const sig = sumarDia_(s);
  return sig.slice(8) === '01' ? sig.slice(0, 7) : null; // era el último día del mes → el mes correcto es el siguiente
}
function repararDesfase_() {
  const cambios = [];
  [['agua_recibos','id'],['cargos','id'],['lecturas_agua','mes'],['cobros','mes']].forEach(([name, colMes]) => {
    const sh = getSs_().getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const headers = SHEETS[name], n = sh.getLastRow() - 1;
    const cM = headers.indexOf(colMes) + 1;
    const colsF = (COLS_FECHA_DESFASE_[name] || []).map(c => headers.indexOf(c) + 1).filter(c => c > 0);
    const datos = sh.getRange(2, 1, n, headers.length).getValues();
    datos.forEach((fila, i) => {
      const bueno = mesDesfasado_(cellValue_(fila[cM - 1], colMes));
      if (!bueno) return;
      const r = i + 2;
      formatoTextoFila_(sh, name, r);
      sh.getRange(r, cM).setValue(bueno);
      colsF.forEach(c => { const v = String(cellValue_(fila[c - 1], headers[c - 1]) || ''); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) sh.getRange(r, c).setValue(sumarDia_(v)); });
      cambios.push(name + ':' + bueno);
    });
  });
  console.log('Desfase reparado en ' + cambios.length + ' filas');
  return cambios;
}

/** Punto de entrada único: lo usan google.script.run (desde index.html) y doGet/doPost. */
function api(body) {
  if (body.action === 'login') return login_(body.codigo);
  const quien = exigirToken_(body.token);
  repararTextosUnaVez_();
  if (quien.rol === 'inquilino') return apiInquilino_(body, quien.depto);
  switch (body.action) {
    case 'ping':    return { ok: true, rol: 'admin' };
    case 'codigoInquilino': return codigoInquilino_(body.depto, body.op);
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
      case 'vincularPdfs': return vincularPdfs_(body.tipo);
      // Guardado en bloque, solo para cargos del mes (al cambiar un valor por defecto se fijan los meses pasados).
      case 'setMany':
        if (body.collection !== 'cargos') throw new Error('setMany_no_permitido');
        (body.docs || []).forEach(d => setDoc_('cargos', d.id, d.data));
        return { ok: true, n: (body.docs || []).length };
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

// ---------------------------------------------------------------------------------------------------------------
// Copia de respaldo semanal de la Hoja de datos en RECIBOS_JARDIN/Respaldos. Se guardan las últimas 8 copias;
// las más antiguas van a la papelera de Drive (se pueden recuperar durante 30 días).
const RESPALDOS_A_GUARDAR = 8;
function respaldoSemanal() {
  const carpeta = getFolder_(['Respaldos']);
  const nombre = 'Respaldo datos ' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HH:mm');
  DriveApp.getFileById(SPREADSHEET_ID).makeCopy(nombre, carpeta);
  const copias = [];
  const it = carpeta.getFiles();
  while (it.hasNext()) { const f = it.next(); if (f.getName().indexOf('Respaldo datos ') === 0) copias.push(f); }
  copias.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  copias.slice(RESPALDOS_A_GUARDAR).forEach(f => f.setTrashed(true));
  console.log('Respaldo creado: ' + nombre + ' (' + Math.min(copias.length, RESPALDOS_A_GUARDAR) + ' copias guardadas)');
}
/** Ejecutar UNA vez desde el editor: programa el respaldo cada lunes a las 3:00 y hace la primera copia. */
function activarRespaldoSemanal() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'respaldoSemanal').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('respaldoSemanal').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(3).create();
  respaldoSemanal();
  console.log('Respaldo semanal activado: cada lunes a las 3:00.');
}
