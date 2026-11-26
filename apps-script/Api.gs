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
 * - Los vínculos manuales (cuando el teléfono no coincide) se guardan en la hoja "Vínculos"
 *   de la planilla de Reclamos.
 */

const API_CFG = {
  INSTALACIONES_SHEET_ID: '1PaPmui11KCGVGMWhwzIt8I2Rngjo8om1_8dEh5EaUdY',
  HOJA_SOLICITUDES: 'Solicitudes',
  HOJA_INSTALADORES: 'Instaladores',
  HOJA_VINCULOS: 'Vínculos',
  CACHE_SEG: 300,
  ORIGENES: { tn: 'Tiendanube', ml: 'Mercado Libre' }
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

    case 'guardar':
      return enriquecer_(panelGuardar(pin, req.id, req.cambios, req.quien)); // valida PIN

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

    default:
      throw new Error('Acción desconocida.');
  }
}

// ---------- Vinculación reclamo ↔ instalación ----------

function enriquecer_(det) {
  const inst = datosInstalaciones_(false);
  det.instalaciones = instalacionesDe_(det.reclamo.id, det.reclamo.whatsapp, det.reclamo.pedido, inst, vinculos_());
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

// ---------- Lectura de la planilla de Instalaciones (solo lectura) ----------

function datosInstalaciones_(refrescar) {
  const cache = CacheService.getScriptCache();
  const KEY = 'api_inst_v2';
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
      const t = porNombre[nombre] || (porNombre[nombre] = { nombre: nombre, ids: [], zonas: [] });
      t.ids.push(String(i.id));
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
