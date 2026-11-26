/*!
 * ELIKE · Panel interno de reclamos técnicos
 * Se monta en elike.com.ar/panel-reclamos/ (o en cualquier página con <div id="elike-reclamos">).
 * Datos: Apps Script "Elike - Reclamos técnicos" (API en Api.gs) → planilla de Google de ELIKE.
 * Repo: github.com/elike-ar/elike-web — servido por jsDelivr.
 */
(function () {
  'use strict';

  var API = 'https://script.google.com/macros/s/AKfycbziOUrATCcCSw2LtFFJI0sPANSF1fBilUEGIrhHd1UVIC6kv5U1qwUcNVEbhkQCMTL4/exec';
  var RUTA = /^\/panel-reclamos\/?$/;
  var LS_PIN = 'elike-reclamos-pin';
  var LS_QUIEN = 'elike-reclamos-quien';

  var mount = document.getElementById('elike-reclamos');
  if (!mount && !RUTA.test(location.pathname)) return;

  // ---------------------------------------------------------------- estado
  var S = {
    pin: leer(LS_PIN),
    quien: leer(LS_QUIEN) || '',
    cfg: null,
    lista: [],
    filtro: 'abiertos',
    q: '',
    det: null,
    cargando: false
  };

  function leer(k) {
    try { return sessionStorage.getItem(k) || localStorage.getItem(k) || ''; } catch (e) { return ''; }
  }
  function guardarLocal(k, v, recordar) {
    try {
      sessionStorage.setItem(k, v);
      if (recordar) localStorage.setItem(k, v); else localStorage.removeItem(k);
    } catch (e) { /* almacenamiento no disponible */ }
  }
  function borrarLocal(k) {
    try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch (e) { /* nada */ }
  }

  // ---------------------------------------------------------------- API
  function api(accion, extra) {
    var body = Object.assign({ accion: accion, pin: S.pin, quien: S.quien }, extra || {});
    // Sin Content-Type explícito → text/plain → no hay preflight CORS con Apps Script.
    return fetch(API, { method: 'POST', body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) {
          if (/PIN|bloqueado/i.test(j.error || '')) { S.pin = ''; borrarLocal(LS_PIN); }
          throw new Error(j.error || 'Error del servidor');
        }
        return j.data;
      });
  }

  // ---------------------------------------------------------------- utilidades
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || mount).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || mount).querySelectorAll(sel)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function aFecha(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d) ? null : d;
  }
  function fCorta(v) {
    var d = aFecha(v);
    if (!d) return v ? esc(v) : '—';
    var dias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    return dias[d.getDay()] + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
  }
  function fHora(v) {
    var d = aFecha(v);
    if (!d) return v ? esc(v) : '—';
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fDia(v) {
    var d = aFecha(v);
    if (!d) return v ? esc(v) : '—';
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function inputFecha(v) {
    var d = aFecha(v);
    return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) : '';
  }
  function inputFechaHora(v) {
    var d = aFecha(v);
    return d ? inputFecha(v) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : '';
  }
  function diasDesde(v) {
    var d = aFecha(v);
    return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null;
  }
  function waLink(num) {
    var d = String(num || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 10) d = '549' + d;
    return 'https://wa.me/' + d;
  }
  function esFinal(estado) { return S.cfg && S.cfg.estadosFinales.indexOf(estado) !== -1; }
  function claseEstado(e) {
    return {
      'Recibido': 'nuevo', 'En análisis': 'analisis', 'Visita agendada': 'visita',
      'Esperando repuesto / cambio': 'espera', 'Resuelto': 'ok', 'Cerrado': 'cerrado', 'No procede': 'cerrado'
    }[e] || 'nuevo';
  }
  function toast(msg, error) {
    var t = document.createElement('div');
    t.className = 'erc-toast' + (error ? ' erc-toast--error' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('erc-toast--fuera'); }, 2600);
    setTimeout(function () { t.remove(); }, 3200);
  }

  // ---------------------------------------------------------------- estilos
  var CSS = [
    '.erc{--erc-dark:#07131c;--erc-acc:#086c1e;--erc-acc2:#0fa33a;--erc-bg:#f4f6f5;--erc-line:#e3e7e5;--erc-txt:#0b0b0b;--erc-mut:#6b7570;font-family:Outfit,system-ui,sans-serif;color:var(--erc-txt);margin:0 calc(50% - 50vw);background:var(--erc-bg);min-height:70vh}',
    '.erc *{box-sizing:border-box}',
    '.erc-hero{background:radial-gradient(1200px 400px at 50% -10%,#123447 0,var(--erc-dark) 60%);color:#fff;text-align:center;padding:56px 20px 96px}',
    '.erc-pill{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:6px 14px;font-size:12px;letter-spacing:.12em;text-transform:uppercase}',
    '.erc-pill:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--erc-acc2)}',
    '.erc-hero h1{font-size:clamp(28px,4vw,44px);margin:18px 0 8px;font-weight:600;color:#fff}',
    '.erc-hero p{margin:0;opacity:.8}',
    '.erc-wrap{max-width:1120px;margin:-64px auto 40px;padding:0 16px}',
    '.erc-card{background:#fff;border-radius:20px;box-shadow:0 10px 40px rgba(7,19,28,.08);padding:20px}',
    '.erc-login{max-width:420px;margin:0 auto;padding:32px}',
    '.erc-login h2{margin:0 0 6px;font-size:22px}',
    '.erc-login p{margin:0 0 18px;color:var(--erc-mut);font-size:14px}',
    '.erc label{display:block;font-size:12px;color:var(--erc-mut);margin:12px 0 4px;text-transform:uppercase;letter-spacing:.05em}',
    '.erc input,.erc select,.erc textarea{width:100%;border:1px solid var(--erc-line);border-radius:10px;padding:10px 12px;font:inherit;font-size:15px;background:#fff;color:inherit}',
    '.erc textarea{min-height:84px;resize:vertical}',
    '.erc input:focus,.erc select:focus,.erc textarea:focus{outline:2px solid var(--erc-acc2);border-color:transparent}',
    '.erc-check{display:flex!important;align-items:center;gap:8px;text-transform:none!important;letter-spacing:0!important;font-size:14px!important}',
    '.erc-check input{width:auto}',
    '.erc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:10px;padding:10px 16px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;background:var(--erc-acc);color:#fff;text-decoration:none}',
    '.erc-btn:hover{filter:brightness(1.08)}',
    '.erc-btn[disabled]{opacity:.5;cursor:default}',
    '.erc-btn--sec{background:#eef2f0;color:var(--erc-txt)}',
    '.erc-btn--wa{background:#25d366;color:#05240f}',
    '.erc-btn--chico{padding:6px 10px;font-size:13px}',
    '.erc-btn--full{width:100%;margin-top:18px}',
    '.erc-error{color:#b3261e;font-size:14px;margin-top:10px;min-height:1em}',
    '.erc-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:14px}',
    '.erc-chips{display:flex;flex-wrap:wrap;gap:8px}',
    '.erc-chip{border:1px solid var(--erc-line);background:#fff;border-radius:999px;padding:7px 12px;font:inherit;font-size:13px;cursor:pointer;color:inherit}',
    '.erc-chip b{margin-left:6px}',
    '.erc-chip--on{background:var(--erc-dark);border-color:var(--erc-dark);color:#fff}',
    '.erc-tools{display:flex;gap:8px;align-items:center;flex:1;justify-content:flex-end;min-width:260px}',
    '.erc-tools input{max-width:320px}',
    '.erc-list{display:flex;flex-direction:column;gap:8px}',
    '.erc-row{display:grid;grid-template-columns:120px 1fr 1fr 170px;gap:14px;align-items:center;border:1px solid var(--erc-line);border-radius:14px;padding:12px 14px;cursor:pointer;background:#fff;transition:border-color .15s,box-shadow .15s}',
    '.erc-row:hover{border-color:#b9c6bf;box-shadow:0 4px 14px rgba(7,19,28,.06)}',
    '.erc-id{font-weight:700}',
    '.erc-mut{color:var(--erc-mut);font-size:13px}',
    '.erc-tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-radius:6px;padding:3px 7px;margin-right:4px}',
    '.erc-tag--nuevo{background:#fff3cd;color:#7a5a00}',
    '.erc-tag--analisis{background:#e3ecff;color:#1d3f9e}',
    '.erc-tag--visita{background:#e6f4ea;color:#086c1e}',
    '.erc-tag--espera{background:#fde7d9;color:#8a3b00}',
    '.erc-tag--ok{background:#d7f5df;color:#05521a}',
    '.erc-tag--cerrado{background:#eceff1;color:#4b5559}',
    '.erc-tag--elk{background:var(--erc-dark);color:#fff}',
    '.erc-tag--alerta{background:#fde2e1;color:#9b1c14}',
    '.erc-vacio{text-align:center;padding:40px;color:var(--erc-mut)}',
    '.erc-ov{position:fixed;inset:0;background:rgba(7,19,28,.45);z-index:99998;display:flex;justify-content:flex-end}',
    '.erc-drawer{width:min(980px,100%);height:100%;overflow:auto;background:var(--erc-bg);padding:0 0 40px;animation:erc-in .2s ease-out}',
    '@keyframes erc-in{from{transform:translateX(40px);opacity:.4}to{transform:none;opacity:1}}',
    '.erc-dh{position:sticky;top:0;z-index:2;background:var(--erc-dark);color:#fff;padding:16px 20px;display:flex;gap:12px;align-items:center;justify-content:space-between}',
    '.erc-dh h3{margin:0;font-size:20px;color:#fff}',
    '.erc-dgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px 20px}',
    '.erc-box{background:#fff;border-radius:16px;padding:16px;border:1px solid var(--erc-line)}',
    '.erc-box h4{margin:0 0 10px;font-size:15px}',
    '.erc-kv{display:grid;grid-template-columns:130px 1fr;gap:6px 10px;font-size:14px}',
    '.erc-kv dt{color:var(--erc-mut)}',
    '.erc-kv dd{margin:0;word-break:break-word}',
    '.erc-falla{white-space:pre-wrap;background:#f7f9f8;border-radius:10px;padding:10px;font-size:14px;margin-top:8px}',
    '.erc-inst{border:1px solid var(--erc-line);border-radius:12px;padding:12px;margin-top:10px;font-size:14px}',
    '.erc-inst-h{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:6px}',
    '.erc-two{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}',
    '.erc-hist{font-size:13px;margin:0;padding:0;list-style:none}',
    '.erc-hist li{padding:6px 0;border-bottom:1px solid var(--erc-line)}',
    '.erc-adj a{display:inline-block;margin:4px 8px 0 0;font-size:14px;color:var(--erc-acc)}',
    '.erc-save{position:sticky;bottom:0;background:#fff;border-top:1px solid var(--erc-line);padding:12px 20px;display:flex;gap:10px;justify-content:flex-end;align-items:center}',
    '.erc-full{grid-column:1/-1}',
    '.erc-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--erc-dark,#07131c);color:#fff;padding:12px 18px;border-radius:12px;z-index:99999;font-family:Outfit,system-ui,sans-serif;transition:opacity .4s}',
    '.erc-toast--error{background:#9b1c14}',
    '.erc-toast--fuera{opacity:0}',
    '.erc-spin{display:inline-block;width:16px;height:16px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:erc-r .7s linear infinite;vertical-align:-3px}',
    '@keyframes erc-r{to{transform:rotate(360deg)}}',
    '@media (max-width:820px){.erc-row{grid-template-columns:1fr;gap:4px}.erc-dgrid,.erc-two{grid-template-columns:1fr}.erc-tools{justify-content:stretch}.erc-tools input{max-width:none}}'
  ].join('\n');

  // ---------------------------------------------------------------- montaje
  function montar() {
    var st = document.createElement('style');
    st.id = 'erc-css';
    st.textContent = CSS;
    document.head.appendChild(st);

    var robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex,nofollow';
    document.head.appendChild(robots);
    document.title = 'Panel de reclamos · Elike';

    if (!mount) {
      // Página de Tiendanube: reemplaza el contenido de la página por el panel.
      var cont = document.querySelector('body > .container') ||
                 document.querySelector('.template-page main') ||
                 document.querySelector('footer');
      mount = document.createElement('div');
      mount.id = 'elike-reclamos';
      if (cont && cont.tagName !== 'FOOTER') { cont.innerHTML = ''; cont.appendChild(mount); }
      else if (cont) { cont.parentNode.insertBefore(mount, cont); }
      else { document.body.appendChild(mount); }
    }
    mount.className = 'erc';
    mount.innerHTML =
      '<header class="erc-hero"><span class="erc-pill">Elike · Panel</span>' +
      '<h1>Panel de reclamos</h1><p>Reclamos técnicos, visitas y técnicos, vinculados con las instalaciones.</p></header>' +
      '<div class="erc-wrap"><div class="erc-card" id="erc-main"></div></div>';

    mount.addEventListener('click', onClick);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.det) cerrarDetalle(); });

    if (S.pin) iniciar(); else pintarLogin();
  }

  // ---------------------------------------------------------------- login
  function pintarLogin(error) {
    $('#erc-main').innerHTML =
      '<form class="erc-login" id="erc-login">' +
      '<h2>Ingresar</h2><p>Panel interno de ELIKE. Usá el PIN del sistema de reclamos.</p>' +
      '<label for="erc-quien">Tu nombre</label><input id="erc-quien" autocomplete="name" required value="' + esc(S.quien) + '" placeholder="Ej: Gustavo">' +
      '<label for="erc-pin">PIN</label><input id="erc-pin" type="password" autocomplete="current-password" required>' +
      '<label class="erc-check"><input type="checkbox" id="erc-rec"> Recordar en este equipo</label>' +
      '<button class="erc-btn erc-btn--full" type="submit">Entrar</button>' +
      '<div class="erc-error" id="erc-err">' + esc(error || '') + '</div></form>';
    $('#erc-login').addEventListener('submit', function (e) {
      e.preventDefault();
      S.pin = $('#erc-pin').value.trim().toUpperCase();
      S.quien = $('#erc-quien').value.trim();
      var rec = $('#erc-rec').checked;
      var btn = $('#erc-login button');
      btn.disabled = true; btn.innerHTML = '<span class="erc-spin"></span>';
      api('login').then(function (cfg) {
        guardarLocal(LS_PIN, S.pin, rec);
        guardarLocal(LS_QUIEN, S.quien, true);
        S.cfg = cfg;
        cargarLista();
      }).catch(function (err) {
        S.pin = '';
        pintarLogin(err.message);
      });
    });
    var foco = S.quien ? $('#erc-pin') : $('#erc-quien');
    if (foco) foco.focus();
  }

  function iniciar() {
    $('#erc-main').innerHTML = '<div class="erc-vacio"><span class="erc-spin"></span> Cargando tu panel…</div>';
    api('login').then(function (cfg) { S.cfg = cfg; cargarLista(); })
      .catch(function (err) { pintarLogin(err.message); });
  }

  // ---------------------------------------------------------------- lista
  function cargarLista(refrescar) {
    S.cargando = true;
    if (!S.lista.length) $('#erc-main').innerHTML = '<div class="erc-vacio"><span class="erc-spin"></span> Cargando reclamos…</div>';
    return api('listar', { refrescar: !!refrescar }).then(function (lista) {
      S.lista = lista;
      S.cargando = false;
      pintarLista();
    }).catch(function (err) {
      S.cargando = false;
      if (!S.pin) pintarLogin(err.message); else toast(err.message, true);
    });
  }

  function filtrados() {
    var q = S.q.trim().toLowerCase();
    return S.lista.filter(function (r) {
      if (S.filtro === 'abiertos' && esFinal(r.estado)) return false;
      if (S.filtro !== 'abiertos' && S.filtro !== 'todos' && r.estado !== S.filtro) return false;
      if (!q) return true;
      return [r.id, r.nombre, r.whatsapp, r.producto, r.tecnico, r.pedido, r.direccion, r.instaladoPorElike]
        .join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }

  function pintarLista() {
    var cuenta = { todos: S.lista.length, abiertos: 0 };
    S.lista.forEach(function (r) {
      cuenta[r.estado] = (cuenta[r.estado] || 0) + 1;
      if (!esFinal(r.estado)) cuenta.abiertos++;
    });
    var chips = ['abiertos'].concat(S.cfg.estados, ['todos']).map(function (k) {
      var n = cuenta[k] || 0;
      if (!n && k !== 'abiertos' && k !== 'todos' && k !== S.filtro) return '';
      var lbl = k === 'abiertos' ? 'Abiertos' : (k === 'todos' ? 'Todos' : k);
      return '<button class="erc-chip' + (S.filtro === k ? ' erc-chip--on' : '') + '" data-filtro="' + esc(k) + '">' + esc(lbl) + '<b>' + n + '</b></button>';
    }).join('');

    var filas = filtrados();
    var html =
      '<div class="erc-top"><div class="erc-chips">' + chips + '</div>' +
      '<div class="erc-tools"><input id="erc-q" type="search" placeholder="Buscar: RT, cliente, teléfono, producto, técnico…" value="' + esc(S.q) + '">' +
      '<button class="erc-btn erc-btn--sec erc-btn--chico" data-acc="refrescar" title="Actualizar">↻</button>' +
      '<button class="erc-btn erc-btn--sec erc-btn--chico" data-acc="salir">Salir</button></div></div>' +
      '<div class="erc-list">' +
      (filas.length ? filas.map(fila).join('') : '<div class="erc-vacio">No hay reclamos con este filtro.</div>') +
      '</div>';
    $('#erc-main').innerHTML = html;
    var inp = $('#erc-q');
    inp.addEventListener('input', function () {
      S.q = inp.value;
      var pos = inp.selectionStart;
      pintarLista();
      var nuevo = $('#erc-q'); nuevo.focus(); try { nuevo.setSelectionRange(pos, pos); } catch (e) { /* nada */ }
    });
  }

  function fila(r) {
    var dias = diasDesde(r.fechaReclamo);
    var alerta = !esFinal(r.estado) && dias !== null && dias >= 7;
    var visita = r.fechaVisita ? 'Visita ' + fHora(r.fechaVisita) : '';
    return '<div class="erc-row" data-id="' + esc(r.id) + '">' +
      '<div><div class="erc-id">' + esc(r.id) + '</div><div class="erc-mut">' + fCorta(r.fechaReclamo) + '</div></div>' +
      '<div><div>' + esc(r.nombre || '—') + '</div><div class="erc-mut">' + esc(r.producto || '') + (r.tipoFalla ? ' · ' + esc(r.tipoFalla) : '') + '</div></div>' +
      '<div><div>' + (r.tecnico ? esc(r.tecnico) : '<span class="erc-mut">Sin técnico</span>') + '</div><div class="erc-mut">' + esc(visita || (r.direccion || '')) + '</div></div>' +
      '<div style="text-align:right"><span class="erc-tag erc-tag--' + claseEstado(r.estado) + '">' + esc(r.estado) + '</span>' +
      (r.instaladoPorElike ? '<div style="margin-top:6px"><span class="erc-tag erc-tag--elk" title="Instalación ELIKE vinculada">' + esc(r.instaladoPorElike) + '</span></div>' : '') +
      (alerta ? '<div style="margin-top:6px"><span class="erc-tag erc-tag--alerta">' + dias + ' días abierto</span></div>' : '') +
      '</div></div>';
  }

  // ---------------------------------------------------------------- detalle
  function abrirDetalle(id) {
    var ov = document.createElement('div');
    ov.className = 'erc-ov erc';
    ov.style.margin = '0';
    ov.innerHTML = '<div class="erc-drawer"><div class="erc-dh"><h3>' + esc(id) + '</h3><button class="erc-btn erc-btn--sec erc-btn--chico" data-acc="cerrar">Cerrar ✕</button></div>' +
      '<div class="erc-vacio"><span class="erc-spin"></span> Cargando reclamo…</div></div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) cerrarDetalle(); else onClick(e); });
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    S.det = { id: id, ov: ov, data: null };
    api('detalle', { id: id }).then(pintarDetalle).catch(function (err) { toast(err.message, true); cerrarDetalle(); });
  }

  function cerrarDetalle() {
    if (!S.det) return;
    if (S.det.data && hayCambios() && !confirmarDescartar()) return;
    S.det.ov.remove();
    S.det = null;
    document.body.style.overflow = '';
  }

  function confirmarDescartar() {
    // Confirmación sin window.confirm: segundo intento de cierre descarta.
    if (S.det.avisado) return true;
    S.det.avisado = true;
    toast('Tenés cambios sin guardar. Volvé a cerrar para descartarlos.', true);
    return false;
  }

  function opciones(lista, actual, vacio) {
    var html = vacio !== undefined ? '<option value="">' + esc(vacio) + '</option>' : '';
    var hay = false;
    lista.forEach(function (v) {
      if (v === actual) hay = true;
      html += '<option' + (v === actual ? ' selected' : '') + '>' + esc(v) + '</option>';
    });
    if (actual && !hay) html += '<option selected>' + esc(actual) + '</option>';
    return html;
  }

  function campo(k, label, html, full) {
    return '<div' + (full ? ' class="erc-full"' : '') + '><label for="erc-f-' + k + '">' + esc(label) + '</label>' + html + '</div>';
  }

  function pintarDetalle(data) {
    if (!S.det) return;
    S.det.data = data;
    S.det.avisado = false;
    var r = data.reclamo;
    var cfg = S.cfg;
    var tecnicos = cfg.tecnicos.map(function (t) { return t.nombre; });
    var wa = waLink(r.whatsapp);

    var cliente =
      '<div class="erc-box"><h4>Cliente</h4><dl class="erc-kv">' +
      '<dt>Nombre</dt><dd>' + esc(r.nombre || '—') + '</dd>' +
      '<dt>WhatsApp</dt><dd>' + esc(r.whatsapp || '—') + '</dd>' +
      '<dt>Dirección</dt><dd>' + esc(r.direccion || '—') + '</dd>' +
      '<dt>Canal</dt><dd>' + esc(r.canal || '—') + (r.pedido ? ' · pedido ' + esc(r.pedido) : '') + '</dd>' +
      '<dt>Instalado por</dt><dd>' + esc(r.instalador || '—') + '</dd>' +
      '<dt>Producto</dt><dd>' + esc(r.producto || '—') + '</dd>' +
      '<dt>Fecha compra</dt><dd>' + fDia(r.fechaCompra) + '</dd>' +
      '<dt>Reclamo</dt><dd>' + fHora(r.fechaReclamo) + '</dd></dl>' +
      (wa ? '<div style="margin-top:12px"><a class="erc-btn erc-btn--wa erc-btn--chico" href="' + esc(wa) + '" target="_blank" rel="noopener">Escribir por WhatsApp</a></div>' : '') +
      '</div>';

    var falla =
      '<div class="erc-box"><h4>Falla reportada</h4>' +
      '<span class="erc-tag erc-tag--analisis">' + esc(r.tipoFalla || 'Sin tipo') + '</span>' +
      '<div class="erc-falla">' + esc(r.falla || 'Sin descripción') + '</div>' +
      '<div class="erc-adj">' + (data.adjuntos.length ? data.adjuntos.map(function (a) {
        return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">📎 ' + esc(a.nombre) + '</a>';
      }).join('') : '<span class="erc-mut">Sin adjuntos</span>') + '</div></div>';

    var inst = '<div class="erc-box erc-full"><h4>Instalación ELIKE vinculada</h4>';
    if (data.instalaciones.length) {
      inst += data.instalaciones.map(function (s) {
        var asignar = s.instalador && s.instalador !== r.tecnico
          ? '<button class="erc-btn erc-btn--sec erc-btn--chico" data-asignar="' + esc(s.instalador) + '">Asignar a ' + esc(s.instalador) + '</button>' : '';
        var quitar = s.vinculo === 'manual'
          ? '<button class="erc-btn erc-btn--sec erc-btn--chico" data-desvincular="' + esc(s.num) + '">Quitar vínculo</button>' : '';
        return '<div class="erc-inst"><div class="erc-inst-h"><div><span class="erc-tag erc-tag--elk">' + esc(s.num) + '</span>' +
          '<span class="erc-mut">' + esc(s.origen) + ' · ' + (s.vinculo === 'manual' ? 'vinculada a mano' : 'coincide por teléfono') + '</span></div>' +
          '<div>' + asignar + ' ' + quitar + '</div></div>' +
          '<dl class="erc-kv">' +
          '<dt>Instalador</dt><dd><b>' + esc(s.instalador || 'Sin asignar') + '</b></dd>' +
          '<dt>Estado</dt><dd>' + esc(s.estado) + (s.fechaInstalada ? ' · instalada el ' + fDia(s.fechaInstalada) : '') + '</dd>' +
          '<dt>Producto</dt><dd>' + esc(s.producto) + (s.cantidad > 1 ? ' ×' + esc(s.cantidad) : '') + '</dd>' +
          '<dt>Cliente</dt><dd>' + esc(s.nombre) + ' · ' + esc(s.tel) + (s.mail ? ' · ' + esc(s.mail) : '') + '</dd>' +
          '<dt>Dirección</dt><dd>' + esc(s.direccion || '—') + '</dd>' +
          '<dt>Solicitud</dt><dd>' + fDia(s.fecha) + '</dd></dl></div>';
      }).join('');
    } else {
      inst += '<p class="erc-mut" style="margin:0">No encontré una instalación de ELIKE con el teléfono ' + esc(r.whatsapp || '') + '. Si la instalamos nosotros, buscala abajo y vinculala.</p>';
    }
    inst += '<div style="display:flex;gap:8px;margin-top:12px"><input id="erc-bi" placeholder="Buscar instalación: ELK-1036, nombre o teléfono">' +
      '<button class="erc-btn erc-btn--sec" data-acc="buscarInst">Buscar</button></div><div id="erc-bi-res"></div></div>';

    var gestion =
      '<div class="erc-box erc-full"><h4>Técnico y visita</h4><div class="erc-two">' +
      campo('estado', 'Estado', '<select id="erc-f-estado" data-k="estado">' + opciones(cfg.estados, r.estado) + '</select>') +
      campo('tecnico', 'Técnico / instalador', '<select id="erc-f-tecnico" data-k="tecnico">' + opciones(tecnicos, r.tecnico, '— Sin asignar —') + '</select>') +
      campo('fechaVisita', 'Fecha y hora de visita', '<input id="erc-f-fechaVisita" type="datetime-local" data-k="fechaVisita" data-tipo="fechahora" value="' + inputFechaHora(r.fechaVisita) + '">') +
      campo('fechaCierre', 'Fecha de cierre', '<input id="erc-f-fechaCierre" type="date" data-k="fechaCierre" data-tipo="fecha" value="' + inputFecha(r.fechaCierre) + '">') +
      campo('diagnostico', 'Diagnóstico', '<textarea id="erc-f-diagnostico" data-k="diagnostico">' + esc(r.diagnostico) + '</textarea>') +
      campo('solucion', 'Solución adoptada', '<textarea id="erc-f-solucion" data-k="solucion">' + esc(r.solucion) + '</textarea>') +
      campo('cambio', '¿Cambio de producto?', '<select id="erc-f-cambio" data-k="cambio">' + opciones(['Sí', 'No'], r.cambio, '—') + '</select>') +
      campo('productoNuevo', 'Producto entregado en cambio', '<select id="erc-f-productoNuevo" data-k="productoNuevo">' + opciones(cfg.productos, r.productoNuevo, '—') + '</select>') +
      campo('fechaCambio', 'Fecha del cambio', '<input id="erc-f-fechaCambio" type="date" data-k="fechaCambio" data-tipo="fecha" value="' + inputFecha(r.fechaCambio) + '">') +
      '<div></div>' +
      campo('mensajeCliente', 'Mensaje para el cliente (lo ve en la página de seguimiento)', '<textarea id="erc-f-mensajeCliente" data-k="mensajeCliente">' + esc(r.mensajeCliente) + '</textarea>', true) +
      campo('notas', 'Notas internas (no las ve el cliente)', '<textarea id="erc-f-notas" data-k="notas">' + esc(r.notas) + '</textarea>', true) +
      '</div></div>';

    var hist = '<div class="erc-box erc-full"><h4>Historial</h4><ul class="erc-hist">' +
      (data.historial.length ? data.historial.slice(0, 40).map(function (h) {
        return '<li><span class="erc-mut">' + fHora(h.fecha) + ' · ' + esc(h.origen || '') + '</span><br><b>' + esc(h.campo) + '</b>: ' +
          (h.antes ? esc(h.antes) + ' → ' : '') + esc(h.despues || '(vacío)') + '</li>';
      }).join('') : '<li class="erc-mut">Sin movimientos</li>') + '</ul></div>';

    var drawer = S.det.ov.querySelector('.erc-drawer');
    drawer.innerHTML =
      '<div class="erc-dh"><div><h3>' + esc(r.id) + ' · ' + esc(r.nombre || '') + '</h3>' +
      '<span class="erc-tag erc-tag--' + claseEstado(r.estado) + '" style="margin-top:6px">' + esc(r.estado) + '</span></div>' +
      '<button class="erc-btn erc-btn--sec erc-btn--chico" data-acc="cerrar">Cerrar ✕</button></div>' +
      '<div class="erc-dgrid">' + cliente + falla + inst + gestion + hist + '</div>' +
      '<div class="erc-save"><span class="erc-mut" id="erc-dirty"></span>' +
      '<button class="erc-btn" data-acc="guardar">Guardar cambios</button></div>';

    $$('[data-k]', drawer).forEach(function (el) { el.addEventListener('input', marcarCambios); el.addEventListener('change', marcarCambios); });
    var bi = drawer.querySelector('#erc-bi');
    bi.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); buscarInstalacion(); } });
  }

  function valorOriginal(k, tipo) {
    var v = S.det.data.reclamo[k];
    if (tipo === 'fecha') return inputFecha(v);
    if (tipo === 'fechahora') return inputFechaHora(v);
    return v == null ? '' : String(v);
  }

  function cambios() {
    var out = {};
    if (!S.det || !S.det.data) return out;
    $$('[data-k]', S.det.ov).forEach(function (el) {
      var k = el.getAttribute('data-k');
      var tipo = el.getAttribute('data-tipo');
      if (String(el.value) !== valorOriginal(k, tipo)) out[k] = el.value;
    });
    return out;
  }
  function hayCambios() { return Object.keys(cambios()).length > 0; }
  function marcarCambios() {
    var n = Object.keys(cambios()).length;
    var el = S.det && S.det.ov.querySelector('#erc-dirty');
    if (el) el.textContent = n ? n + (n === 1 ? ' cambio sin guardar' : ' cambios sin guardar') : '';
  }

  function guardar(btn) {
    var c = cambios();
    if (!Object.keys(c).length) { toast('No hay cambios para guardar.'); return; }
    btn.disabled = true; btn.innerHTML = '<span class="erc-spin"></span> Guardando';
    api('guardar', { id: S.det.id, cambios: c }).then(function (data) {
      toast('Guardado ✓');
      pintarDetalle(data);
      actualizarEnLista(data.reclamo, data.instalaciones);
    }).catch(function (err) {
      toast(err.message, true);
      btn.disabled = false; btn.textContent = 'Guardar cambios';
    });
  }

  function actualizarEnLista(r, inst) {
    var i = S.lista.findIndex(function (x) { return x.id === r.id; });
    r.instalaciones = inst.length;
    r.instaladoPorElike = inst.length ? inst[0].num : '';
    if (i !== -1) S.lista[i] = r;
    pintarLista();
  }

  function buscarInstalacion() {
    var inp = S.det.ov.querySelector('#erc-bi');
    var res = S.det.ov.querySelector('#erc-bi-res');
    var q = inp.value.trim();
    if (q.length < 3) { res.innerHTML = '<p class="erc-mut">Escribí al menos 3 caracteres.</p>'; return; }
    res.innerHTML = '<p class="erc-mut"><span class="erc-spin"></span> Buscando…</p>';
    api('buscarInstalacion', { q: q }).then(function (lista) {
      var ya = S.det.data.instalaciones.map(function (s) { return s.num; });
      res.innerHTML = lista.length ? lista.map(function (s) {
        return '<div class="erc-inst"><div class="erc-inst-h"><div><span class="erc-tag erc-tag--elk">' + esc(s.num) + '</span> ' +
          esc(s.nombre) + ' · ' + esc(s.tel) + '</div>' +
          (ya.indexOf(s.num) === -1 ? '<button class="erc-btn erc-btn--chico" data-vincular="' + esc(s.num) + '">Vincular</button>' : '<span class="erc-mut">Ya vinculada</span>') +
          '</div><div class="erc-mut">' + esc(s.producto) + ' · ' + esc(s.direccion) + ' · ' + esc(s.instalador || 'sin instalador') + ' · ' + esc(s.estado) + '</div></div>';
      }).join('') : '<p class="erc-mut">Sin resultados.</p>';
    }).catch(function (err) { res.innerHTML = '<p class="erc-error">' + esc(err.message) + '</p>'; });
  }

  function vincular(num, quitar) {
    if (hayCambios()) { toast('Guardá los cambios antes de vincular.', true); return; }
    api(quitar ? 'desvincular' : 'vincular', { id: S.det.id, num: num }).then(function (data) {
      toast(quitar ? 'Vínculo quitado' : 'Instalación vinculada ✓');
      pintarDetalle(data);
      actualizarEnLista(data.reclamo, data.instalaciones);
    }).catch(function (err) { toast(err.message, true); });
  }

  // ---------------------------------------------------------------- eventos
  function onClick(e) {
    var t = e.target.closest('[data-filtro],[data-acc],[data-id],[data-asignar],[data-vincular],[data-desvincular]');
    if (!t) return;
    if (t.hasAttribute('data-filtro')) { S.filtro = t.getAttribute('data-filtro'); pintarLista(); return; }
    if (t.hasAttribute('data-asignar')) {
      var sel = S.det.ov.querySelector('#erc-f-tecnico');
      var nombre = t.getAttribute('data-asignar');
      if (!Array.prototype.some.call(sel.options, function (o) { return o.value === nombre; })) {
        var o = document.createElement('option'); o.textContent = nombre; sel.appendChild(o);
      }
      sel.value = nombre;
      marcarCambios();
      sel.focus();
      return;
    }
    if (t.hasAttribute('data-vincular')) { vincular(t.getAttribute('data-vincular'), false); return; }
    if (t.hasAttribute('data-desvincular')) { vincular(t.getAttribute('data-desvincular'), true); return; }
    if (t.hasAttribute('data-acc')) {
      var acc = t.getAttribute('data-acc');
      if (acc === 'refrescar') cargarLista(true);
      else if (acc === 'salir') { borrarLocal(LS_PIN); S.pin = ''; S.lista = []; pintarLogin(); }
      else if (acc === 'cerrar') cerrarDetalle();
      else if (acc === 'guardar') guardar(t);
      else if (acc === 'buscarInst') buscarInstalacion();
      return;
    }
    if (t.hasAttribute('data-id')) abrirDetalle(t.getAttribute('data-id'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
