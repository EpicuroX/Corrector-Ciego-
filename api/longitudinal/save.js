/* ============================================================================
 * DARABIA · LONGITUDINAL · SAVE
 * api/longitudinal/save.js
 *
 * Inserta una evaluación validada por el profesor en la BD longitudinal.
 * Marca la nueva fila como is_latest=true y las anteriores del mismo
 * alumno+caso como is_latest=false. Todo en una transacción atómica.
 *
 * NORMALIZACIÓN DE EJES (incorporada en esta versión):
 * El motor de evaluación (api/evaluar.js) devuelve vector_ejes en escala
 * ABSOLUTA: cada eje tiene una puntuación entre 0 y su 'max', donde 'max' es
 * la suma de los pesos de los criterios que componen ese eje (p.ej. 25 si el
 * eje agrega criterios de peso 10 + 15). Esto es correcto pedagógicamente
 * para la vista del corrector (el alumno ve "21/25 en análisis"), pero rompe
 * la comparabilidad longitudinal entre casos cuyas rúbricas pesan distinto.
 *
 * Solución (Opción A, decisión sesión normalización mayo 2026):
 *   Este endpoint normaliza cada eje a escala 0-10 antes de guardar en BD.
 *   Fórmula: puntuacion_normalizada = (puntuacion / max) * 10, 1 decimal.
 *   El dashboard longitudinal lee siempre 0-10 y pinta sin lógica adicional.
 *
 * CONTRATO DE PAYLOAD (vector_ejes):
 *   Cada elemento DEBE incluir 'max'. Sin 'max' no podemos normalizar y el
 *   endpoint rechaza el payload con error explícito. Esto evita guardar
 *   silenciosamente datos sin normalizar (que es el bug que estamos arreglando).
 *
 * Body esperado (JSON):
 *   {
 *     student_id: "PRL2526_001",
 *     case_id: "psicosocial_gestoria_v1",
 *     case_order: 1,                       // opcional
 *     vector_ejes: [                       // 5 ejes obligatorios, cada uno con max
 *       { eje: "capacidad_analisis",         puntuacion: 21, max: 25 },
 *       { eje: "uso_marcos_teoricos",        puntuacion: 13, max: 20 },
 *       { eje: "criterio_intervencion",      puntuacion: 16, max: 20 },
 *       { eje: "deteccion_riesgos_criticos", puntuacion: 22, max: 30 },
 *       { eje: "argumentacion_profesional",  puntuacion: 10, max: 15 }
 *     ],
 *     score_total: 70.0,
 *     validated_by: "jonas.agudo",         // opcional
 *     notes: "..."                          // opcional
 *   }
 *
 * Tras la normalización, la fila guardada en BD tendrá:
 *   axis_analisis      = 8.4   (21/25 * 10)
 *   axis_modelos       = 6.5   (13/20 * 10)
 *   axis_intervencion  = 8.0   (16/20 * 10)
 *   axis_riesgos       = 7.3   (22/30 * 10)
 *   axis_argumentacion = 6.7   (10/15 * 10)
 * ============================================================================ */

import { neon } from '@neondatabase/serverless';

const EJES_REQUERIDOS = [
    'capacidad_analisis',
    'uso_marcos_teoricos',
    'criterio_intervencion',
    'deteccion_riesgos_criticos',
    'argumentacion_profesional'
];

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'Solo POST.' });
    }

    // 1. Validación del payload
    const body = req.body || {};
    const errores = validarPayload(body);
    if (errores.length > 0) {
        return res.status(400).json({ error: 'PAYLOAD_INVALIDO', detalles: errores });
    }

    // 2. Normalización de ejes a escala 0-10
    //    Tras validarPayload sabemos que cada eje tiene 'puntuacion' y 'max' válidos.
    const ejesMap = {};
    for (const item of body.vector_ejes) {
        const puntuacion = Number(item.puntuacion);
        const max = Number(item.max);
        // (puntuacion / max) * 10, redondeado a 1 decimal
        const normalizada = Math.round((puntuacion / max) * 10 * 10) / 10;
        ejesMap[item.eje] = normalizada;
    }

    const fila = {
        student_id: String(body.student_id).trim(),
        case_id: String(body.case_id).trim(),
        case_order: body.case_order != null ? Number(body.case_order) : null,
        axis_analisis: ejesMap['capacidad_analisis'],
        axis_modelos: ejesMap['uso_marcos_teoricos'],
        axis_intervencion: ejesMap['criterio_intervencion'],
        axis_riesgos: ejesMap['deteccion_riesgos_criticos'],
        axis_argumentacion: ejesMap['argumentacion_profesional'],
        score_total: Number(body.score_total),
        validated_by: body.validated_by ? String(body.validated_by).trim() : null,
        notes: body.notes ? String(body.notes) : null
    };

    // 3. Conexión y transacción
    if (!process.env.DATABASE_URL) {
        return res.status(500).json({
            error: 'CONFIG_ERROR',
            message: 'DATABASE_URL no configurada en variables de entorno.'
        });
    }

    const sql = neon(process.env.DATABASE_URL);

    try {
        // Transacción: marcamos las anteriores como is_latest=false
        // y luego insertamos la nueva con is_latest=true.
        // Si cualquiera falla, ambas se revierten.
        const [, insertadas] = await sql.transaction([
            sql`
                UPDATE evaluaciones_longitudinales
                SET is_latest = FALSE
                WHERE student_id = ${fila.student_id}
                  AND case_id = ${fila.case_id}
                  AND is_latest = TRUE
            `,
            sql`
                INSERT INTO evaluaciones_longitudinales (
                    student_id, case_id, case_order,
                    status, is_latest, vector_origen,
                    axis_analisis, axis_modelos, axis_intervencion,
                    axis_riesgos, axis_argumentacion,
                    score_total, validated_by, validated_at, notes
                )
                VALUES (
                    ${fila.student_id}, ${fila.case_id}, ${fila.case_order},
                    'validated', TRUE, 'evaluador',
                    ${fila.axis_analisis}, ${fila.axis_modelos}, ${fila.axis_intervencion},
                    ${fila.axis_riesgos}, ${fila.axis_argumentacion},
                    ${fila.score_total}, ${fila.validated_by}, NOW(), ${fila.notes}
                )
                RETURNING id, student_id, case_id, timestamp, is_latest
            `
        ]);

        return res.status(200).json({
            ok: true,
            message: 'Evaluación guardada correctamente.',
            evaluacion: insertadas[0]
        });

    } catch (err) {
        console.error('[LONGITUDINAL/SAVE] Error en transacción:', err);
        return res.status(500).json({
            error: 'DB_ERROR',
            message: err.message || 'Error desconocido al guardar.'
        });
    }
}

/* ============================================================================
 * Validación del payload
 *
 * Reglas:
 *   - student_id, case_id: strings no vacíos.
 *   - vector_ejes: array de exactamente 5 elementos, uno por eje requerido.
 *   - Cada elemento de vector_ejes:
 *       · eje: uno de los 5 EJES_REQUERIDOS.
 *       · puntuacion: número finito >= 0.
 *       · max: número finito > 0.
 *       · puntuacion <= max (no aceptamos puntuaciones que excedan el techo
 *         del eje — sería un bug del motor que debe explotar pronto).
 *   - score_total: número entre 0 y 100.
 *
 * NOTA: el rango anterior de puntuacion (0-100) se ha sustituido por
 * (0 <= puntuacion <= max), porque ahora el contrato de payload acepta
 * valores absolutos por eje (que pueden ser menores de 100, p.ej. max=15).
 * ============================================================================ */

function validarPayload(body) {
    const errores = [];

    if (!body.student_id || typeof body.student_id !== 'string' || !body.student_id.trim()) {
        errores.push('student_id obligatorio (string no vacío).');
    }
    if (!body.case_id || typeof body.case_id !== 'string' || !body.case_id.trim()) {
        errores.push('case_id obligatorio (string no vacío).');
    }

    if (!Array.isArray(body.vector_ejes) || body.vector_ejes.length !== 5) {
        errores.push('vector_ejes debe ser un array de 5 elementos.');
    } else {
        const ejesRecibidos = body.vector_ejes.map(e => e?.eje);
        for (const ejeReq of EJES_REQUERIDOS) {
            if (!ejesRecibidos.includes(ejeReq)) {
                errores.push(`Falta el eje "${ejeReq}" en vector_ejes.`);
            }
        }
        for (const item of body.vector_ejes) {
            const eje = item?.eje;
            const puntuacion = Number(item?.puntuacion);
            const max = Number(item?.max);

            if (!Number.isFinite(puntuacion) || puntuacion < 0) {
                errores.push(`Puntuación inválida en eje "${eje}": ${item?.puntuacion} (debe ser número >= 0).`);
            }
            if (!Number.isFinite(max) || max <= 0) {
                errores.push(`'max' ausente o inválido en eje "${eje}": ${item?.max}. Cada eje debe enviar 'max' (suma de pesos de sus criterios) para poder normalizar a escala 0-10.`);
            }
            if (Number.isFinite(puntuacion) && Number.isFinite(max) && max > 0 && puntuacion > max) {
                errores.push(`Puntuación (${puntuacion}) excede 'max' (${max}) en eje "${eje}".`);
            }
        }
    }

    const score = Number(body.score_total);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
        errores.push('score_total debe ser un número entre 0 y 100.');
    }

    return errores;
}
