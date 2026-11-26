/*!
 * ELIKE · cargador de herramientas propias sobre Tiendanube.
 * Se incluye en TODAS las páginas (sello del footer), pesa ~2 KB y no hace nada fuera de estas rutas:
 *   /panel-reclamos/  → carga reclamos/panel.js (panel interno)
 *   /reclamo/         → formulario de reclamo técnico para clientes (Apps Script embebido)
 *   /seguimiento/     → seguimiento del reclamo para clientes (Apps Script embebido)
 * En esas rutas agrega <meta name="robots" content="noindex,nofollow">.
 * Repo: github.com/elike-ar/elike-web
 */
(function () {
  'use strict';

  var RUTAS = { '/panel-reclamos/': 'panel', '/reclamo/': 'formulario', '/seguimiento/': 'seguimiento' };
  var ruta = location.pathname.replace(/\/?$/, '/');
  var modo = RUTAS[ruta];
  if (!modo) return;

  var APP = 'https://script.google.com/macros/s/AKfycbziOUrATCcCSw2LtFFJI0sPANSF1fBilUEGIrhHd1UVIC6kv5U1qwUcNVEbhkQCMTL4/exec';
  var yo = document.currentScript;
  var BASE = yo && yo.src ? yo.src.replace(/[^\/]*$/, '') : 'https://cdn.jsdelivr.net/gh/elike-ar/elike-web@main/';

  var robots = document.createElement('meta');
  robots.name = 'robots';
  robots.content = 'noindex,nofollow';
  document.head.appendChild(robots);

  if (modo === 'panel') {
    var s = document.createElement('script');
    s.src = BASE + 'reclamos/panel.js';
    document.head.appendChild(s);
    return;
  }

  var esForm = modo === 'formulario';
  var TXT = esForm
    ? { pill: 'Elike · Soporte', h1: 'Reclamo técnico', p: 'Contanos qué pasó con tu producto. Te respondemos a la brevedad.',
        alt: '¿Ya cargaste tu reclamo? <a href="/seguimiento/">Seguilo acá</a>.', title: 'Reclamo técnico · Elike' }
    : { pill: 'Elike · Soporte', h1: 'Seguimiento de tu reclamo', p: 'Ingresá tu número de reclamo (RT-…) y los últimos 4 dígitos de tu WhatsApp.',
        alt: '¿Todavía no cargaste tu reclamo? <a href="/reclamo/">Hacelo acá</a>.', title: 'Seguimiento de reclamo · Elike' };

  var CSS =
    '.erf{font-family:Outfit,system-ui,sans-serif;margin:0 calc(50% - 50vw);background:#f4f6f5;padding-bottom:40px}' +
    '.erf-hero{background:radial-gradient(1200px 400px at 50% -10%,#123447 0,#07131c 60%);color:#fff;text-align:center;padding:48px 20px 90px}' +
    '.erf-pill{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:6px 14px;font-size:12px;letter-spacing:.12em;text-transform:uppercase}' +
    '.erf-pill:before{content:"";width:8px;height:8px;border-radius:50%;background:#0fa33a}' +
    '.erf-hero h1{font-size:clamp(28px,4vw,42px);margin:16px 0 8px;font-weight:600;color:#fff}' +
    '.erf-hero p{margin:0 auto;max-width:560px;opacity:.85}' +
    '.erf-wrap{max-width:760px;margin:-60px auto 0;padding:0 16px}' +
    '.erf-card{background:#fff;border-radius:20px;box-shadow:0 10px 40px rgba(7,19,28,.08);overflow:hidden}' +
    '.erf-card iframe{display:block;width:100%;height:900px;border:0;transition:height .2s}' +
    '.erf-alt{text-align:center;color:#6b7570;font-size:14px;margin:16px 0 0}' +
    '.erf-alt a{color:#086c1e;font-weight:600}';

  function montar() {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    document.title = TXT.title;

    var q = new URLSearchParams(location.search);
    if (!esForm) q.set('p', 'seguimiento');
    var src = APP + (q.toString() ? '?' + q.toString() : '');

    var w = document.createElement('div');
    w.className = 'erf';
    w.innerHTML =
      '<header class="erf-hero"><span class="erf-pill">' + TXT.pill + '</span><h1>' + TXT.h1 + '</h1><p>' + TXT.p + '</p></header>' +
      '<div class="erf-wrap"><div class="erf-card"><iframe credentialless title="' + TXT.h1 + '" src="' + src.replace(/"/g, '&quot;') + '"></iframe></div>' +
      '<p class="erf-alt">' + TXT.alt + '<br>¿No se ve el formulario? <a href="' + src.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">Abrilo en otra pestaña</a>.</p></div>';

    var cont = document.querySelector('body > .container');
    if (cont) { cont.innerHTML = ''; cont.appendChild(w); }
    else { var f = document.querySelector('footer'); (f ? f.parentNode : document.body).insertBefore(w, f || null); }

    var frame = w.querySelector('iframe');
    // credentialless: Google lo abre como visitante anónimo (como lo ve el cliente). Evita el error
    // "No se pudo abrir el archivo" cuando el navegador tiene varias cuentas de Google abiertas.
    // El formulario avisa su alto por postMessage para que no haya doble scroll.
    window.addEventListener('message', function (e) {
      if (!/(^https:\/\/script\.google\.com$)|googleusercontent\.com$/.test(e.origin)) return;
      var d = e.data;
      // Alto exacto (sin margen extra): si el formulario usa min-height:100vh, el tamaño queda estable y no crece en loop.
      if (d && d.erc === 'alto' && d.h > 0) frame.style.height = Math.max(480, Math.min(6000, Math.ceil(d.h))) + 'px';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
