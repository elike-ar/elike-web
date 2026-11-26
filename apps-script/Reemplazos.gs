/**
 * ELIKE · Reclamos técnicos — Registro de unidades reemplazadas (hoja "Reemplazos").
 * ---------------------------------------------------------------------------------
 * Una fila por unidad reemplazada (RP-0001, RP-0002…). Se carga desde el panel interno:
 *   - desde la ficha de un reclamo (botón "Registrar reemplazo", con los datos precargados), o
 *   - a mano, sin reclamo (pestaña Reemplazos → "Cargar reemplazo").
 * Al registrar un reemplazo de un reclamo, el reclamo queda con "¿Cambio de producto?" = Sí,
 * el producto entregado y la fecha del cambio, y el movimiento queda en el Historial.
 * Usa helpers de Código.gs (ss_, buscarFila_, verificarPin_, txt_, txtLargo_, tel_, elegir_,
 * parseFecha_, iso_, historial_, panelGuardar).
 */

const RP = {
  HOJA: 'Reemplazos',
  PREFIJO: 'RP',
  ORIGENES: ['Depósito', 'Stock instalador'],
  DEVOLUCION: ['Pendiente', 'Recibida en depósito', 'No aplica'],
  COLS: [
    ['id', 'ID'],
    ['fecha', 'Fecha de reemplazo'],
    ['reclamo', 'ID reclamo'],
    ['cliente', 'Cliente'],
    ['whatsapp', 'WhatsApp'],
    ['canal', 'Canal de compra'],
    ['pedido', 'Nº de pedido / venta'],
    ['elk', 'Instalación ELK'],
    ['productoRetirado', 'Producto retirado (con falla)'],
    ['productoEntregado', 'Producto entregado'],
    ['origen', 'Origen unidad nueva'],
    ['tipoFalla', 'Tipo de falla'],
    ['diagnostico', 'Diagnóstico'],
    ['tecnico', 'Técnico / instalador'],
    ['devolucion', 'Devolución unidad con falla'],
    ['fechaRecepcion', 'Fecha recepción en depósito'],
    ['notas', 'Notas'],
    ['cargadoPor', 'Cargado por'],
    ['creado', 'Fecha de carga'],
    ['actualizado', 'Última actualización']
  ]
};
RP.KEYS = RP.COLS.map(c => c[0]);
RP.IDX = RP.KEYS.reduce((o, k, i) => { o[k] = i; return o; }, {});

/** Acciones del panel para reemplazos. Devuelve undefined si la acción no es de reemplazos. */
function apiReemplazos_(req) {
  const pin = String(req.pin || '');
  switch (req.accion) {
    case 'reemplazos':
      verificarPin_(pin);
      return { lista: rpListar_(), origenes: RP.ORIGENES, devolucion: RP.DEVOLUCION };
    case 'reemplazoGuardar':
      verificarPin_(pin);
      return rpGuardar_(req.datos || {}, txt_(req.quien, 40) || 'Panel', pin);
    default:
      return undefined;
  }
}

/** Reemplazos de un reclamo (para la ficha). */
function reemplazosDe_(id) {
  try { return rpListar_(String(id || '')); } catch (e) { return []; }
}

function rpListar_(idReclamo) {
  const sh = ss_().getSheetByName(RP.HOJA);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, RP.KEYS.length).getValues()
    .filter(r => r[0] && (!idReclamo || String(r[RP.IDX.reclamo]).trim().toUpperCase() === idReclamo.toUpperCase()))
    .map(rpSerializar_)
    .reverse();
}

function rpSerializar_(r) {
  const o = {};
  RP.KEYS.forEach((k, i) => { o[k] = (r[i] instanceof Date) ? iso_(r[i]) : r[i]; });
  o.whatsapp = String(o.whatsapp || '');
  o.pedido = String(o.pedido || '');
  return o;
}

function rpHoja_() {
  const ss = ss_();
  let sh = ss.getSheetByName(RP.HOJA);
  if (sh) return sh;
  sh = ss.insertSheet(RP.HOJA);
  sh.getRange(1, 1, 1, RP.COLS.length).setValues([RP.COLS.map(c => c[1])])
    .setFontWeight('bold').setBackground('#07131c').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  const n = 2000;
  const lista = vals => SpreadsheetApp.newDataValidation().requireValueInList(vals, true).setAllowInvalid(false).build();
  sh.getRange(2, RP.IDX.origen + 1, n, 1).setDataValidation(lista(RP.ORIGENES));
  sh.getRange(2, RP.IDX.devolucion + 1, n, 1).setDataValidation(lista(RP.DEVOLUCION));
  ['fecha', 'fechaRecepcion'].forEach(k => sh.getRange(2, RP.IDX[k] + 1, n, 1).setNumberFormat('dd/mm/yyyy'));
  ['creado', 'actualizado'].forEach(k => sh.getRange(2, RP.IDX[k] + 1, n, 1).setNumberFormat('dd/mm/yyyy hh:mm'));
  ['whatsapp', 'pedido'].forEach(k => sh.getRange(2, RP.IDX[k] + 1, n, 1).setNumberFormat('@'));
  sh.setColumnWidths(1, RP.COLS.length, 150);
  return sh;
}

function rpGuardar_(d, quien, pin) {
  const v = {};
  v.fecha = parseFecha_(d.fecha) || new Date();
  v.reclamo = String(d.reclamo || '').trim().toUpperCase();
  if (v.reclamo && !buscarFila_(v.reclamo)) throw new Error('No existe el reclamo ' + v.reclamo);
  v.cliente = txt_(d.cliente, 120);
  v.whatsapp = tel_(d.whatsapp);
  v.canal = txt_(d.canal, 60);
  v.pedido = txt_(d.pedido, 40);
  v.elk = txt_(d.elk, 20).toUpperCase();
  v.productoRetirado = txt_(d.productoRetirado, 120);
  if (!v.productoRetirado) throw new Error('Falta el producto retirado.');
  v.productoEntregado = txt_(d.productoEntregado, 120);
  v.origen = elegir_(d.origen, RP.ORIGENES);
  if (!v.origen) throw new Error('Elegí el origen de la unidad nueva.');
  v.tipoFalla = txt_(d.tipoFalla, 120);
  v.diagnostico = txtLargo_(d.diagnostico, 3000);
  v.tecnico = txt_(d.tecnico, 80);
  v.devolucion = elegir_(d.devolucion, RP.DEVOLUCION) || 'Pendiente';
  v.fechaRecepcion = v.devolucion === 'Recibida en depósito' ? (parseFecha_(d.fechaRecepcion) || new Date()) : '';
  v.notas = txtLargo_(d.notas, 3000);
  v.actualizado = new Date();

  const editar = String(d.id || '').trim().toUpperCase();
  let id;
  let nuevo = false;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = rpHoja_();
    if (editar) {
      const cel = sh.getRange('A:A').createTextFinder(editar).matchEntireCell(true).findNext();
      if (!cel || cel.getRow() < 2) throw new Error('No existe el reemplazo ' + editar);
      const fila = sh.getRange(cel.getRow(), 1, 1, RP.KEYS.length);
      const actual = fila.getValues()[0];
      RP.KEYS.forEach((k, i) => { if (k in v) actual[i] = v[k]; });
      fila.setValues([actual]);
      id = editar;
    } else {
      const props = PropertiesService.getScriptProperties();
      const n = Number(props.getProperty('ULTIMO_RP') || 0) + 1;
      props.setProperty('ULTIMO_RP', String(n));
      id = RP.PREFIJO + '-' + ('000' + n).slice(-4);
      v.id = id;
      v.cargadoPor = quien;
      v.creado = new Date();
      sh.appendRow(RP.KEYS.map(k => (k in v ? v[k] : '')));
      nuevo = true;
    }
  } finally {
    lock.releaseLock();
  }

  // Reflejo en el reclamo (fuera del lock: panelGuardar toma su propio lock).
  if (v.reclamo) {
    if (nuevo) historial_(v.reclamo, 'Reemplazo registrado', '', id + ' · ' + v.productoRetirado + ' → ' + (v.productoEntregado || 'sin dato'), quien);
    const cambios = { cambio: 'Sí', fechaCambio: Utilities.formatDate(v.fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd') };
    if (v.productoEntregado) cambios.productoNuevo = v.productoEntregado;
    const fr = buscarFila_(v.reclamo);
    if (v.tecnico && fr && !fr.datos[IDX.tecnico]) cambios.tecnico = v.tecnico; // solo si el reclamo no tenía técnico
    panelGuardar(pin, v.reclamo, cambios, quien);
  }
  return { id: id, lista: rpListar_() };
}
