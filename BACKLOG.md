# BACKLOG · Darabia Engine V5 · Evaluador-Corrector

Deuda técnica **reconocida y documentada**, no escondida. Cada punto incluye:

- **Qué**: la pieza pendiente.
- **Disparador**: qué evento debe ocurrir para que toque construirla. Hasta entonces, no se toca.
- **Estimación**: tiempo honesto, asumiendo la base actual.
- **Dónde mirar**: archivos y líneas con el comentario `BACKLOG:` correspondiente.

> Filosofía: *"cada una de estas piezas se construye en 1-3 días CUANDO la necesite. Hacerlas hoy como ingeniería preventiva es trabajo de semanas que probablemente no usaré nunca."*

---

## 1. Selector de caso visible al profesor

**Qué**: sustituir el atributo `data-caso-id` del `<body>` por un selector visible en el formulario de subida (dropdown o radios) que el profesor elige al subir cada PDF. Listado de casos leído desde un endpoint nuevo (`/api/casos`) o desde un JSON estático servido por el frontend.

**Disparador**:
- Cuando haya **3 o más rúbricas activas en paralelo** durante un mismo curso, o
- Cuando el profesor cambie de caso más de una vez por trimestre y editar manualmente el HTML resulte molesto, o
- Cuando otros profesores empiecen a usar el sistema (cada uno con su rúbrica).

**Estimación**: 1-2 días.
- 0.5 días: endpoint `/api/casos` que devuelva el listado del registro `CASOS`.
- 0.5 días: dropdown en el frontend leyendo de ese endpoint.
- 0.5-1 día: testing con varios casos cargados, validación de errores cuando se elige un caso inexistente.

**Dónde mirar**:
- `corrector.html` línea ~457 (atributo `data-caso-id` del `<body>`) — comentario BACKLOG presente.
- `corrector.html` línea ~605 (objeto `CONFIG`) — lectura del data-attribute.
- `evaluar.js` líneas ~37-44 (registro `CASOS`) — comentario BACKLOG presente.

---

## 2. Labels de criterios/ejes/knockouts leídos del JSON

**Qué**: eliminar los diccionarios `LABELS_CRITERIOS`, `LABELS_EJES` y `LABELS_KNOCKOUTS` del frontend. En su lugar, leer los nombres legibles directamente del JSON del caso. Para ello, el JSON necesitará enriquecerse:

- `ejes_evaluacion`: pasar de array de strings a array de objetos `{id, nombre}` (o añadir un objeto paralelo `ejes_metadata`).
- `knockout_criteria.{id}`: añadir un campo `nombre` corto al lado de `descripcion`.

Alternativamente, el backend puede enriquecer la respuesta con los nombres legibles (menos tocar JSONs, más cambio de contrato).

**Disparador**:
- Cuando un nuevo caso introduzca IDs de criterios, ejes o knockouts **no contemplados** en `LABELS_*`, y se vea texto técnico crudo (`descripcion_carga`, `senyal_xyz`, etc.) renderizado en pantalla.

**Estimación**: 0.5-1 día.
- 0.25 días: enriquecer schema del JSON.
- 0.25 días: actualizar `evaluar.js` para validar el nuevo shape.
- 0.25-0.5 días: refactor del frontend para leer de la respuesta enriquecida.

**Dónde mirar**:
- `corrector.html` líneas ~862-887 (bloque `LABELS_*` y funciones `formatear*`) — comentario BACKLOG presente.

**Nota**: hasta que esto se haga, el fallback `LABELS_X[id] || id` garantiza que la app no rompe — solo muestra el id técnico crudo. Feo, no roto.

---

## 3. Histórico longitudinal por alumno (perfil de competencias)

**Qué**: acumular el `vector_ejes` de cada evaluación por alumno y caso, para generar al final del curso una **gráfica de evolución competencial** (radar comparativo Caso 01, 02, 03... o gráfico longitudinal por eje). Esto está alineado con el Principio 1.bis del briefing original ("acumular perfiles de competencias por alumno a lo largo del curso").

**Disparador**:
- Cuando se acumulen **3 o más casos evaluados** por curso, y
- Cuando exista voluntad real de devolver al alumno una gráfica de evolución (no solo notas individuales).

**Decisión técnica pendiente**: dónde persistir.
- Opción A: archivo JSON local que el profesor descarga/sube cada vez (sin servidor).
- Opción B: tabla en una BD ligera (SQLite en Vercel KV, o Supabase free tier).
- Opción C: hoja de cálculo Google Sheets vía API.

**Estimación**: 2-3 días según opción.

**Dónde mirar**:
- Todavía sin código que lo implemente. La estructura `vector_ejes` ya existe en la respuesta del backend desde Fase 0.

---

## 4. Editor visual de rúbricas / plantilla de creación

**Qué**: herramienta para crear nuevos JSON de caso sin escribir mano a mano. Dos caminos posibles:

- **Plantilla manual documentada (Opción A del briefing)**: un `caso_template.json` comentado + un README con instrucciones paso a paso, y ayuda puntual de Claude para generar nuevas rúbricas.
- **Editor visual** (futuro lejano): formulario web que produce el JSON.

**Disparador**:
- Cuando se cree la **segunda rúbrica para una asignatura distinta** (FOL, IPE…) y duplicar el JSON a mano resulte propenso a errores.
- Decisión ya cerrada en otro chat: cuando llegue el momento → **Opción A** (plantilla manual + Claude).

**Estimación**:
- Opción A: 0.5 días para crear la plantilla y el README.
- Opción B (editor visual): 3-5 días. **Descartado por ahora**.

**Dónde mirar**:
- Todavía sin código. Pendiente de empezar.

---

## Convenciones del backlog

- Los puntos NO se priorizan en orden numérico. Cada uno se ataca cuando su disparador se cumple, no antes.
- Si aparece un punto nuevo durante el desarrollo de Fases 1, 2 o posteriores, se añade aquí con el mismo formato.
- Si un punto se cierra (se construye), se mueve a una sección `## Histórico` al final con la fecha de cierre.
- Si un punto deja de tener sentido (cambio de criterio, deprecación), se marca como `~~tachado~~` con razón breve, no se borra.
