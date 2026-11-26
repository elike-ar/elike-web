# elike-web

Código propio de ELIKE que corre sobre la tienda de Tiendanube (elike.com.ar).

## Cargador — `elike.js`

Es lo único que va en el sello del footer de Tiendanube (todas las páginas). Pesa ~2 KB y **no hace nada** fuera de estas rutas, que además marca con `noindex`:

| Ruta | Qué muestra |
|---|---|
| `/panel-reclamos/` | Panel interno (carga `reclamos/panel.js`) |
| `/reclamo/` | Formulario de reclamo técnico para clientes (Apps Script embebido) |
| `/seguimiento/` | Seguimiento del reclamo para clientes (Apps Script embebido; acepta `?id=`) |

Línea del sello:
```html
<script src="https://cdn.jsdelivr.net/gh/elike-ar/elike-web@<commit>/elike.js" defer></script>
```
El cargador toma `reclamos/panel.js` del mismo commit, así que hay un solo hash para actualizar.

Para embeber el formulario, el `doGet` del Apps Script usa `XFrameOptionsMode.ALLOWALL` y `Formulario.html` / `Seguimiento.html` llevan al final `apps-script/alto-embebido.html` (avisa el alto para que no haya doble scroll).

## Panel de reclamos — `reclamos/panel.js`

Panel interno para gestionar los reclamos técnicos. Está en `elike.com.ar/panel-reclamos/`.

```
elike.com.ar/panel-reclamos/   ← página de Tiendanube (contenido vacío)
        │  footer → "sello personalizado" carga reclamos/panel.js desde jsDelivr
        ▼
cdn.jsdelivr.net/gh/elike-ar/elike-web@<commit>/reclamos/panel.js
        │  POST {accion, pin, ...}
        ▼
Apps Script "Elike - Reclamos técnicos" (cuenta gustavo.retegui@elike-ar.com)
  ├─ Código.gs  → formulario del cliente, seguimiento, lógica de reclamos
  └─ Api.gs     → API JSON del panel (copia en apps-script/Api.gs)
        │
        ├─ Planilla "Elike - Reclamos técnicos"  (lectura/escritura)
        └─ Planilla "Elike · Instalaciones (sistema PRAXIS)"  (SOLO lectura: técnicos e instalaciones)
```

### Qué hace

- **El cliente** carga el reclamo con el formulario de siempre (link del Apps Script) y lo sigue en la página de seguimiento.
- **ELIKE** en el panel: cambia el estado, asigna el técnico (la lista sale de la pestaña *Instaladores* del sistema de instalaciones), agenda la visita, carga el diagnóstico y la solución, registra cambios de producto, deja un mensaje para el cliente y notas internas.
- **Vínculo con la instalación**: cada reclamo busca automáticamente su instalación ELIKE por **teléfono** (normalizado: +54, 9, 0 y 15 no importan). Si no coincide, se busca a mano (ELK-xxxx, nombre o teléfono) y se vincula. Los vínculos manuales quedan en la hoja *Vínculos* de la planilla de reclamos.
- Cada cambio queda en la hoja *Historial* con quién lo hizo.

### Reemplazos de unidades

Pestaña **Reemplazos de unidades** del panel y hoja **Reemplazos** de la planilla (`apps-script/Reemplazos.gs`). Una fila por unidad reemplazada (RP-0001…):

- Desde la ficha de un reclamo → **Registrar reemplazo** (datos del reclamo precargados). El reclamo queda con "¿Cambio de producto?" = Sí, producto entregado y fecha del cambio, y el movimiento va al Historial.
- Sin reclamo → **+ Cargar reemplazo** (carga manual).
- Se registra el **origen de la unidad nueva** (Depósito / Stock instalador) y la **devolución de la unidad con falla** (Pendiente / Recibida en depósito / No aplica + fecha de recepción). Filtros: devolución pendiente, del stock del instalador, todos.

### Seguridad

- El PIN del panel (propiedad `PANEL_PIN` del Apps Script, 8 caracteres) se valida **en el servidor en cada acción**. Después de 10 intentos fallidos el panel se bloquea 10 minutos.
- El código de este repo no tiene datos ni claves: los datos solo los devuelve el Apps Script con el PIN correcto.
- Para cambiar el PIN: en la planilla de reclamos, menú del sistema → *Cambiar PIN* (o ejecutar `cambiarPin()`).

### Publicar un cambio

1. Commit y push a `main`.
2. Copiar el hash del commit y actualizarlo en la línea de `elike.js` del sello (Tiendanube → Diseño → Editar diseño → Pie de página → "Código Javascript o HTML del sello", debajo de la línea de Praxis).
   Fijar el commit (en vez de `@main`) evita la caché de jsDelivr y permite volver atrás cambiando solo el hash.

### Cambios en el Apps Script (`apps-script/Api.gs`)

Pegar el archivo en el proyecto *Elike - Reclamos técnicos* → Implementar → Administrar implementaciones → editar → *Nueva versión* → Implementar. La URL del web app no cambia.
