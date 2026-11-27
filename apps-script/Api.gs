/**
 * ELIKE · Reclamos técnicos — API JSON para el panel interno de elike.com.ar/panel-reclamos/
 * ---------------------------------------------------------------------------------------
 * Este archivo se SUMA al proyecto de Apps Script "Elike - Reclamos técnicos".
 * No modifica Código.gs: reutiliza sus funciones (panelListar, panelDetalle, panelGuardar,
 * verificarPin_, productos_, ESTADOS, etc.).
 *
 * - El panel llama por POST con cuerpo JSON en text/plain (sin preflight CORS):
 *     { accion, pin, ...parámetros }
 * - El PIN se valida en el servidor en TODAS las acciones (verificarPin_ bloquea 10 min
 *   después de 10 intentos fallidos).
 * - Lee la planilla de Instalaciones (sistema PRAXIS) en SOLO LECTURA: técnicos y
 *   solicitudes instaladas, para vincular cada reclamo con su instalación por teléfono.
 * - Estados: Recibido → Derivada al técnico (genera el WhatsApp al técnico) → Resuelto / No procede.
 * - Los vínculos manuales (cuando el teléfono no coincide) se guardan en la hoja "Vínculos"
 *   de la planilla de Reclamos.
 */

const API_CFG = {
  INSTALACIONES_SHEET_ID: '1PaPmui11KCGVGMWhwzIt8I2Rngjo8om1_8dEh5EaUdY',
  HOJA_SOLICITUDES: 'Solicitudes',
  HOJA_INSTALADORES: 'Instaladores',
  HOJA_VINCULOS: 'Vínculos',
  CACHE_SEG: 300,
  ORIGENES: { tn: 'Tiendanube', ml: 'Mercado Libre' },
  ESTADO_DERIVADA: 'Derivada al técnico',
  // Al derivar, la carpeta de fotos/videos de ESE reclamo se comparte por link (solo lectura)
  // para que el técnico la pueda abrir desde el WhatsApp. Poner false para no compartir.
  COMPARTIR_ADJUNTOS: true
};

// Estados que se dejaron de usar → estado nuevo (ver migrarEstados)
const ESTADOS_VIEJOS = {
  'En análisis': 'Recibido',
  'Visita agendada': 'Derivada al técnico',
  'Esperando repuesto / cambio': 'Derivada al técnico',
  'Cerrado': 'Resuelto'
};

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = { ok: true, data: api_(req) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function api_(req) {
  const pin = String(req.pin || '');
  switch (req.accion) {
    case 'login':
      verificarPin_(pin);
      return {
        estados: ESTADOS,
        estadosFinales: ESTADOS_FINALES,
        editables: EDITABLES,
        productos: productos_(),
        tiposFalla: TIPOS_FALLA,
        tecnicos: datosInstalaciones_(!!req.refrescar).tecnicos
      };

    case 'listar': {
      const lista = panelListar(pin); // valida PIN
      const inst = datosInstalaciones_(!!req.refrescar);
      const vinc = vinculos_();
      lista.forEach(r => {
        const m = instalacionesDe_(r.id, r.whatsapp, r.pedido, inst, vinc);
        r.instalaciones = m.length;
        r.instaladoPorElike = m.length ? m[0].num : '';
        r.ordenElike = m.length ? m[0].nroOrden : '';
      });
      return lista;
    }

    case 'detalle':
      return enriquecer_(panelDetalle(pin, req.id)); // valida PIN

    case 'guardar': {
      verificarPin_(pin);
      const antes = buscarFila_(req.id);
      if (!antes) throw new Error('No existe el reclamo ' + req.id);
      const c = req.cambios || {};
      const estadoNuevo = c.estado !== undefined ? c.estado : antes.datos[IDX.estado];
      const tecnicoNuevo = c.tecnico !== undefined ? String(c.tecnico || '').trim() : String(antes.datos[IDX.tecnico] || '').trim();
      const derivar = estadoNuevo === API_CFG.ESTADO_DERIVADA &&
        (antes.datos[IDX.estado] !== API_CFG.ESTADO_DERIVADA || tecnicoNuevo !== String(antes.datos[IDX.tecnico] || '').trim());
      if (estadoNuevo === API_CFG.ESTADO_DERIVADA) {
        if (!tecnicoNuevo) throw new Error('Para derivar el reclamo, elegí el técnico.');
        if (derivar && !tecnicoPorNombre_(tecnicoNuevo).wa) throw new Error(tecnicoNuevo + ' no tiene teléfono cargado en la pestaña Instaladores.');
      }
      const det = enriquecer_(panelGuardar(pin, req.id, c, req.quien));
      if (derivar) det.derivacion = derivacion_(det, req.quien);
      return det;
    }

    case 'derivacion': { // reenviar el WhatsApp al técnico
      const det = enriquecer_(panelDetalle(pin, req.id)); // valida PIN
      if (det.reclamo.estado !== API_CFG.ESTADO_DERIVADA || !det.reclamo.tecnico) throw new Error('El reclamo no está derivado a un técnico.');
      det.derivacion = derivacion_(det, req.quien);
      return det;
    }

    case 'buscarInstalacion': {
      verificarPin_(pin);
      const q = String(req.q || '').trim().toLowerCase();
      if (q.length < 3) return [];
      const qTel = claveTel_(q);
      const qNum = q.replace(/^elk-?/, '');
      const qOrden = q.replace(/\D/g, '');
      return datosInstalaciones_(false).sols.filter(s =>
        String(s.numero) === qNum ||
        (qOrden.length >= 3 && claveOrden_(s.nroOrden) === qOrden) ||
        (qTel.length >= 6 && s.clave.indexOf(qTel.slice(-8)) !== -1) ||
        String(s.nombre).toLowerCase().indexOf(q) !== -1
      ).slice(0, 15).map(limpiar_);
    }

    case 'vincular': {
      verificarPin_(pin);
      const id = String(req.id || '').trim().toUpperCase();
      const num = String(req.num || '').trim().toUpperCase();
      if (!buscarFila_(id)) throw new Error('No existe el reclamo ' + id);
      if (!datosInstalaciones_(false).sols.some(s => s.num === num)) throw new Error('No existe la instalación ' + num);
      const sh = hojaVinculos_();
      sh.appendRow([id, num, new Date(), txt_(req.quien, 40) || 'Panel']);
      historial_(id, 'Instalación vinculada', '', num, txt_(req.quien, 40) || 'Panel');
      return enriquecer_(panelDetalle(pin, id));
    }

    case 'desvincular': {
      verificarPin_(pin);
      const id = String(req.id || '').trim().toUpperCase();
      const num = String(req.num || '').trim().toUpperCase();
      const sh = hojaVinculos_();
      const n = sh.getLastRow();
      if (n >= 2) {
        const vals = sh.getRange(2, 1, n - 1, 2).getValues();
        for (let i = vals.length - 1; i >= 0; i--) {
          if (String(vals[i][0]) === id && String(vals[i][1]) === num) sh.deleteRow(i + 2);
        }
      }
      historial_(id, 'Instalación vinculada', num, '', txt_(req.quien, 40) || 'Panel');
      return enriquecer_(panelDetalle(pin, id));
    }

    default: {
      const rp = apiReemplazos_(req); // Reemplazos.gs
      if (rp !== undefined) return rp;
      throw new Error('Acción desconocida.');
    }
  }
}

// ---------- Vinculación reclamo ↔ instalación ----------

function enriquecer_(det) {
  const inst = datosInstalaciones_(false);
  det.instalaciones = instalacionesDe_(det.reclamo.id, det.reclamo.whatsapp, det.reclamo.pedido, inst, vinculos_());
  det.reemplazos = reemplazosDe_(det.reclamo.id); // Reemplazos.gs
  return det;
}

/** Instalaciones de un reclamo: primero las vinculadas a mano, después las que coinciden por nº de pedido y por teléfono. */
function instalacionesDe_(id, tel, pedido, inst, vinc) {
  const out = [];
  const vistos = {};
  (vinc[id] || []).forEach(num => {
    const s = inst.porNum[num];
    if (s && !vistos[num]) { vistos[num] = 1; out.push(Object.assign(limpiar_(s), { vinculo: 'manual' })); }
  });
  const ko = claveOrden_(pedido);
  if (ko) {
    (inst.porOrden[ko] || []).forEach(s => {
      if (!vistos[s.num]) { vistos[s.num] = 1; out.push(Object.assign(limpiar_(s), { vinculo: 'pedido' })); }
    });
  }
  const k = claveTel_(tel);
  if (k) {
    const cand = inst.porTel[k] || (k.length >= 8 ? inst.porTel8[k.slice(-8)] : null) || [];
    cand.forEach(s => {
      if (!vistos[s.num]) { vistos[s.num] = 1; out.push(Object.assign(limpiar_(s), { vinculo: 'telefono' })); }
    });
  }
  return out;
}

function limpiar_(s) {
  const o = Object.assign({}, s);
  delete o.clave;
  return o;
}

function vinculos_() {
  const sh = ss_().getSheetByName(API_CFG.HOJA_VINCULOS);
  const map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    const id = String(r[0] || '').trim();
    if (id && r[1]) (map[id] = map[id] || []).push(String(r[1]).trim());
  });
  return map;
}

function hojaVinculos_() {
  const ss = ss_();
  let sh = ss.getSheetByName(API_CFG.HOJA_VINCULOS);
  if (!sh) {
    sh = ss.insertSheet(API_CFG.HOJA_VINCULOS);
    sh.getRange(1, 1, 1, 4).setValues([['ID reclamo', 'Instalación (ELK)', 'Fecha', 'Quién']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ---------- Derivación al técnico por WhatsApp ----------

function tecnicoPorNombre_(nombre) {
  nombre = String(nombre || '').trim();
  return datosInstalaciones_(false).tecnicos.filter(t => t.nombre === nombre)[0] ||
    datosInstalaciones_(true).tecnicos.filter(t => t.nombre === nombre)[0] || {};
}

/** Arma el WhatsApp para el técnico con los datos del cliente y la falla; lo deja en el Historial. */
function derivacion_(det, quien) {
  const r = det.reclamo;
  const t = tecnicoPorNombre_(r.tecnico);
  if (!t.wa) throw new Error(r.tecnico + ' no tiene teléfono cargado en la pestaña Instaladores.');
  const tz = Session.getScriptTimeZone();
  const dia = v => v ? Utilities.formatDate(new Date(v), tz, 'dd/MM/yyyy') : '';
  const kCli = claveTel_(r.whatsapp);
  const waCliente = kCli.length === 10 ? 'https://wa.me/549' + kCli : (r.whatsapp || '—');

  let carpeta = '';
  if (det.adjuntos && det.adjuntos.length && /folders\/([\w-]+)/.test(String(r.carpeta || ''))) {
    carpeta = r.carpeta;
    if (API_CFG.COMPARTIR_ADJUNTOS) {
      try {
        DriveApp.getFolderById(String(r.carpeta).match(/folders\/([\w-]+)/)[1])
          .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (e) { carpeta = ''; } // la política de la cuenta no permite compartir por link
    }
  }
  const inst = (det.instalaciones || [])[0];
  const compra = [r.canal, dia(r.fechaCompra), r.pedido ? 'pedido ' + r.pedido : ''].filter(Boolean).join(' · ');
  const L = [
    'Hola ' + String(t.nombre).split(' ')[0] + '! Te derivamos un reclamo técnico de ELIKE.',
    '',
    '*Reclamo:* ' + r.id,
    '*Cliente:* ' + (r.nombre || '—'),
    '*WhatsApp del cliente:* ' + waCliente,
    '*Dirección:* ' + (r.direccion || '—'),
    '*Producto:* ' + (r.producto || '—'),
    '*Compra:* ' + (compra || '—')
  ];
  if (inst) L.push('*Instalación ELIKE:* ' + inst.num + (inst.instalador ? ' · ' + inst.instalador : '') + (inst.fechaInstalada ? ' · instalada el ' + dia(inst.fechaInstalada) : ''));
  L.push('', '*Falla reportada:* ' + (r.tipoFalla || '—'), String(r.falla || '').slice(0, 900));
  if (carpeta) L.push('', '*Fotos y videos del cliente:* ' + carpeta);
  else if (det.adjuntos && det.adjuntos.length) L.push('', '(El cliente adjuntó ' + det.adjuntos.length + ' archivo/s; te los pasamos aparte.)');
  L.push('', 'Por favor contactá al cliente para profundizar el diagnóstico o coordinar la visita, y avisanos la fecha. ¡Gracias!');

  historial_(r.id, 'WhatsApp al técnico', '', t.nombre, txt_(quien, 40) || 'Panel');
  return { tecnico: t.nombre, wa: 'https://wa.me/' + t.wa + '?text=' + encodeURIComponent(L.join('\n')) };
}

/**
 * Pasa los reclamos con estados que ya no existen al estado nuevo (ESTADOS_VIEJOS) y lo deja en el Historial.
 * Ejecutar UNA vez desde el editor después de actualizar ESTADOS en Código.gs.
 */
function migrarEstados() {
  const sh = hoja_(HOJA.RECLAMOS);
  const n = sh.getLastRow();
  if (n < 2) return;
  const rango = sh.getRange(2, IDX.estado + 1, n - 1, 1);
  const vals = rango.getValues();
  const ids = sh.getRange(2, 1, n - 1, 1).getValues();
  let cambios = 0;
  vals.forEach((v, i) => {
    const nuevo = ESTADOS_VIEJOS[v[0]];
    if (!nuevo) return;
    historial_(ids[i][0], 'Estado', v[0], nuevo, 'Migración de estados');
    v[0] = nuevo;
    cambios++;
  });
  rango.setValues(vals);
  Logger.log('Reclamos migrados: ' + cambios);
}

// ---------- Lectura de la planilla de Instalaciones (solo lectura) ----------

function datosInstalaciones_(refrescar) {
  const cache = CacheService.getScriptCache();
  const KEY = 'api_inst_v3';
  let data = null;
  if (!refrescar) {
    const hit = cache.get(KEY);
    if (hit) data = JSON.parse(hit);
  }
  if (!data) {
    const ss = SpreadsheetApp.openById(API_CFG.INSTALACIONES_SHEET_ID);
    const inst = tabla_(ss.getSheetByName(API_CFG.HOJA_INSTALADORES));
    const nombres = {};
    inst.forEach(i => { nombres[i.id] = String(i.nombre || '').trim(); });

    // Técnicos activos, sin duplicados por nombre (un mismo técnico puede tener varias altas por zona)
    const porNombre = {};
    inst.filter(i => String(i.activo).trim().toLowerCase() === 'si' && !/prueba/i.test(i.nombre)).forEach(i => {
      const nombre = String(i.nombre).trim();
      const t = porNombre[nombre] || (porNombre[nombre] = { nombre: nombre, ids: [], zonas: [], wa: '' });
      t.ids.push(String(i.id));
      const k = claveTel_(i.tel);
      if (!t.wa && k.length === 10) t.wa = '549' + k;
      String(i.zonas || '').split(',').map(z => z.trim()).filter(Boolean)
        .forEach(z => { if (t.zonas.indexOf(z) === -1) t.zonas.push(z); });
    });
    const tecnicos = Object.keys(porNombre).sort().map(n => porNombre[n]);

    const sols = tabla_(ss.getSheetByName(API_CFG.HOJA_SOLICITUDES))
      .filter(s => s.num && !/^eliminada$/i.test(String(s.estado).trim()) && !/prueba praxis/i.test(String(s.nombre)))
      .map(s => ({
        num: 'ELK-' + s.num,
        numero: String(s.num),
        fecha: fechaTxt_(s.fecha),
        origen: API_CFG.ORIGENES[String(s.origen).trim()] || String(s.origen || ''),
        nombre: String(s.nombre || '').trim(),
        tel: String(s.tel || '').trim(),
        mail: String(s.mail || '').trim(),
        nroOrden: String(s.nro_orden || '').trim(),
        producto: String(s.producto || '').trim(),
        cantidad: s.cantidad || '',
        direccion: [s.dir, s.ciudad, s.prov].map(x => String(x || '').trim()).filter(Boolean).join(', '),
        estado: String(s.estado || '').trim(),
        instalador: nombres[String(s.inst_id)] || '',
        fechaInstalada: fechaTxt_(s.f_instalada),
        clave: claveTel_(s.tel)
      }));
    data = { tecnicos: tecnicos, sols: sols };
    try { cache.put(KEY, JSON.stringify(data), API_CFG.CACHE_SEG); } catch (e) { /* demasiado grande para caché: se lee cada vez */ }
  }
  // Índices (no se cachean: se arman en memoria)
  data.porNum = {}; data.porTel = {}; data.porTel8 = {}; data.porOrden = {};
  data.sols.forEach(s => {
    data.porNum[s.num] = s;
    const ko = claveOrden_(s.nroOrden);
    if (ko) (data.porOrden[ko] = data.porOrden[ko] || []).push(s);
    if (s.clave) {
      (data.porTel[s.clave] = data.porTel[s.clave] || []).push(s);
      if (s.clave.length >= 8) {
        const k8 = s.clave.slice(-8);
        (data.porTel8[k8] = data.porTel8[k8] || []).push(s);
      }
    }
  });
  return data;
}

function tabla_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getDataRange().getValues();
  const head = vals.shift().map(h => String(h).trim());
  return vals.map(r => {
    const o = {};
    head.forEach((h, i) => { if (h) o[h] = r[i]; });
    return o;
  });
}

function fechaTxt_(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString();
  return String(v || '').trim();
}

/**
 * Normaliza un teléfono argentino a 10 dígitos (código de área + número):
 * saca +54, el 9 de celulares, el 0 y el 15. Ej: "+54 9 11 6975-5353", "011 15 6975 5353"
 * y "1169755353" dan todos "1169755353".
 */
function claveTel_(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  d = d.replace(/^00/, '');
  if (d.length > 10 && d.indexOf('54') === 0) d = d.slice(2);
  if (d.length === 11 && d.charAt(0) === '9') d = d.slice(1);
  if (d.charAt(0) === '0') d = d.slice(1);
  if (d.length === 12) {
    for (const n of [2, 3, 4]) {
      if (d.substr(n, 2) === '15') { d = d.slice(0, n) + d.slice(n + 2); break; }
    }
  }
  if (d.length === 8) d = '11' + d; // número de AMBA sin característica
  return d.length > 10 ? d.slice(-10) : d;
}

/** Nº de orden normalizado (solo dígitos): "#623" → "623"; ventas de Mercado Libre de 16 dígitos quedan igual. */
function claveOrden_(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 3 ? d : '';
}

/** Prueba rápida desde el editor: elegí "probarApi" en el menú y tocá Ejecutar. */
function probarApi() {
  ['+54 9 11 6975-5353', '011 15 6975 5353', '1169755353', '6975-5353', '+54 9 351 456-7890', '0351 15 4567890']
    .forEach(t => Logger.log(t + ' → ' + claveTel_(t)));
  const d = datosInstalaciones_(true);
  Logger.log('Técnicos activos: ' + d.tecnicos.map(t => t.nombre).join(', '));
  Logger.log('Instalaciones leídas: ' + d.sols.length);
}
