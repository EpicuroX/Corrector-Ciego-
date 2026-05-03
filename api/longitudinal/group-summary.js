/* ============================================================================
 * DARABIA · LONGITUDINAL · GROUP SUMMARY
 * api/longitudinal/group-summary.js
 *
 * Devuelve un resumen agregado del aula: una fila por alumno con la nota
 * actual, el delta desde su primer caso, mejor/peor eje y tendencia.
 *
 * Esta vista alimenta /dashboard-grupo.html. Es complementaria de
 * /api/longitudinal/get (perfil de UN alumno) y reutiliza la misma BD y
 * convenciones (escala 0-10 ya normalizada, is_latest, case_order).
 *
 * MOTOR CIEGO:
 *   El endpoint no conoce los nombres de los casos. Solo lee filas
 *   evaluaciones_longitudinales y agrega. Si mañana añades Caso 06 o 07,
 *   esto sigue funcionando sin tocarlo.
 *
 * LOPD:
 *   Solo se manejan códigos de alumno (PRL2526_001...). Nunca nombres.
 *
 * MÉTRICAS POR ALUMNO (definiciones acordadas):
 *   - num_casos          → total de casos validados (filas con is_latest=true)
 *   - last_validated_at  → fecha de la validación más reciente
 *   - last_case_id       → case_id del caso más reciente (referencia)
 *   - media_actual       → media de los 5 ejes del caso más reciente
 *   - delta_media        → media_actual − media del caso con case_order más bajo
 *   - mejor_eje          → eje con mayor puntuación en el caso más reciente
 *   - peor_eje           → eje con menor puntuación en el caso más reciente
 *   - tendencia          → 'ascendente' | 'estable' | 'descendente'
 *                          (umbral ±0.5, igual que dashboard-alumno.html)
 *                          'sin_datos' si num_casos < 2
 *
 * AGREGADOS DE AULA (calculados en este endpoint, no en frontend):
 *   - num_alumnos        → total
 *   - num_alumnos_con_delta → alumnos con 2+ casos (los que sí entran en cálculos)
 *   - media_aula         → media de medias_actuales (solo de los con 2+ casos)
 *   - rango_aula         → max(media_actual) − min(media_actual)
 *   - num_riesgo         → alumnos con tendencia descendente
 *   - num_destacados     → alumnos con tendencia ascendente
 *   - num_un_solo_caso   → alumnos con 1 caso (informativo)
 *
 * QUERY (?cohorte=PRL2526):
 *   Filtra por prefijo de student_id (case-insensitive). Opcional.
 *
 * EJES:
 *   Mapeo entre nombre de columna BD (axis_*) y label visual lo hace el
 *   frontend con su EJES_CONFIG. Aquí devolvemos solo los IDs de columna
 *   para que el motor siga siendo agnóstico a la denominación humana.
 * ============================================================================ */

import { neon } from '@neondatabase/serverless';

const EJES = [
    'axis_analisis',
    'axis_modelos',
    'axis_intervencion',
    'axis_riesgos',
    'axis_argumentacion'
];

const UMBRAL_TENDENCIA = 0.5; // mismo que dashboard-alumno.html

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'Solo GET.' });
    }

    if (!process.env.DATABASE_URL) {
        return res.status(500).json({
            error: 'CONFIG_ERROR',
            message: 'DATABASE_URL no configurada en variables de entorno.'
        });
    }

    const cohorte = (req.query.cohorte || '').trim();
    const sql = neon(process.env.DATABASE_URL);

    try {
        // Una sola consulta: traemos TODAS las filas validadas (is_latest=true)
        // ordenadas por alumno y por case_order. La agregación por alumno la
        // hacemos en JS porque (a) las series son cortas (2-3 casos por alumno)
        // y (b) facilita mantener una única definición de "tendencia" en el
        // código y reutilizar la del dashboard individual.
        //
        // Nota: filtramos por status='validated' por defensa, aunque is_latest
        // ya implica validada en el contrato actual.
        const filas = cohorte
            ? await sql`
                SELECT student_id, case_id, case_order,
                       axis_analisis, axis_modelos, axis_intervencion,
                       axis_riesgos, axis_argumentacion,
                       score_total, validated_at
                FROM evaluaciones_longitudinales
                WHERE is_latest = TRUE
                  AND status = 'validated'
                  AND student_id ILIKE ${cohorte + '%'}
                ORDER BY student_id ASC, case_order ASC NULLS LAST, validated_at ASC
            `
            : await sql`
                SELECT student_id, case_id, case_order,
                       axis_analisis, axis_modelos, axis_intervencion,
                       axis_riesgos, axis_argumentacion,
                       score_total, validated_at
                FROM evaluaciones_longitudinales
                WHERE is_latest = TRUE
                  AND status = 'validated'
                ORDER BY student_id ASC, case_order ASC NULLS LAST, validated_at ASC
            `;

        // Agrupar por alumno
        const porAlumno = new Map();
        for (const f of filas) {
            if (!porAlumno.has(f.student_id)) porAlumno.set(f.student_id, []);
            porAlumno.get(f.student_id).push(f);
        }

        // Construir resumen por alumno
        const alumnos = [];
        for (const [studentId, evals] of porAlumno) {
            alumnos.push(construirResumenAlumno(studentId, evals));
        }

        // Orden estable por código de alumno (alfabético)
        alumnos.sort((a, b) => a.student_id.localeCompare(b.student_id));

        // Agregados de aula
        const agregados = calcularAgregadosAula(alumnos);

        return res.status(200).json({
            ok: true,
            cohorte: cohorte || null,
            ejes: EJES,
            agregados,
            alumnos
        });

    } catch (err) {
        console.error('[LONGITUDINAL/GROUP-SUMMARY] Error:', err);
        return res.status(500).json({
            error: 'DB_ERROR',
            message: err.message || 'Error desconocido al consultar el aula.'
        });
    }
}

/* ============================================================================
 * Construcción del resumen de un alumno a partir de sus filas ordenadas
 * cronológicamente (case_order ASC).
 * ============================================================================ */

function construirResumenAlumno(studentId, evals) {
    const numCasos = evals.length;
    const ultimo = evals[numCasos - 1];
    const primero = evals[0];

    // Media del caso más reciente (= "media_actual" del alumno)
    const mediaActual = mediaEjes(ultimo);

    // Mejor y peor eje en el caso más reciente
    const { mejor, peor } = mejorPeorEje(ultimo);

    // Delta de medias (último vs primero). Si solo hay 1 caso, null.
    let deltaMedia = null;
    let tendencia = 'sin_datos';
    if (numCasos >= 2) {
        const mediaPrimera = mediaEjes(primero);
        deltaMedia = redondea(mediaActual - mediaPrimera, 2);
        tendencia = clasificarTendencia(deltaMedia);
    }

    return {
        student_id: studentId,
        num_casos: numCasos,
        last_case_id: ultimo.case_id,
        last_validated_at: ultimo.validated_at,
        last_score_total: ultimo.score_total != null ? Number(ultimo.score_total) : null,
        media_actual: redondea(mediaActual, 1),
        delta_media: deltaMedia,
        mejor_eje: mejor,   // { eje: 'axis_analisis', valor: 8.4 }
        peor_eje: peor,     // { eje: 'axis_riesgos',  valor: 5.2 }
        tendencia
    };
}

function mediaEjes(fila) {
    const valores = EJES
        .map(k => Number(fila[k]))
        .filter(v => Number.isFinite(v));
    if (valores.length === 0) return 0;
    return valores.reduce((a, b) => a + b, 0) / valores.length;
}

function mejorPeorEje(fila) {
    let mejor = null;
    let peor = null;
    for (const k of EJES) {
        const v = Number(fila[k]);
        if (!Number.isFinite(v)) continue;
        if (mejor === null || v > mejor.valor) mejor = { eje: k, valor: redondea(v, 1) };
        if (peor === null || v < peor.valor)   peor  = { eje: k, valor: redondea(v, 1) };
    }
    return { mejor, peor };
}

function clasificarTendencia(delta) {
    if (delta >= UMBRAL_TENDENCIA) return 'ascendente';
    if (delta <= -UMBRAL_TENDENCIA) return 'descendente';
    return 'estable';
}

function redondea(n, decimales) {
    const f = Math.pow(10, decimales);
    return Math.round(n * f) / f;
}

/* ============================================================================
 * Agregados de aula
 *
 * Decisión de diseño (sesión 03 may 2026):
 *   Los alumnos con 1 solo caso NO entran en media_aula ni en rango_aula,
 *   porque mezclan datos sin delta con datos con delta y distorsionan la
 *   foto. Sí cuentan en num_alumnos (informativo) y se exponen aparte
 *   como num_un_solo_caso.
 * ============================================================================ */

function calcularAgregadosAula(alumnos) {
    const conDelta = alumnos.filter(a => a.num_casos >= 2);
    const numUnSoloCaso = alumnos.length - conDelta.length;

    let mediaAula = null;
    let rangoAula = null;
    let mediaMaxima = null;
    let mediaMinima = null;

    if (conDelta.length > 0) {
        const medias = conDelta.map(a => a.media_actual);
        mediaMaxima = Math.max(...medias);
        mediaMinima = Math.min(...medias);
        mediaAula = redondea(medias.reduce((a, b) => a + b, 0) / medias.length, 1);
        rangoAula = redondea(mediaMaxima - mediaMinima, 1);
        mediaMaxima = redondea(mediaMaxima, 1);
        mediaMinima = redondea(mediaMinima, 1);
    }

    const numRiesgo = conDelta.filter(a => a.tendencia === 'descendente').length;
    const numDestacados = conDelta.filter(a => a.tendencia === 'ascendente').length;
    const numEstables = conDelta.filter(a => a.tendencia === 'estable').length;

    return {
        num_alumnos: alumnos.length,
        num_alumnos_con_delta: conDelta.length,
        num_un_solo_caso: numUnSoloCaso,
        media_aula: mediaAula,
        rango_aula: rangoAula,
        media_maxima: mediaMaxima,
        media_minima: mediaMinima,
        num_destacados: numDestacados,
        num_estables: numEstables,
        num_riesgo: numRiesgo
    };
}
