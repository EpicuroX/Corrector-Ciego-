/* ============================================================================
 * DARABIA · LONGITUDINAL · SAVE
 * api/longitudinal/save.js
 *
 * Inserta una evaluación validada por el profesor en la BD longitudinal.
 * Marca la nueva fila como is_latest=true y las anteriores del mismo
 * alumno+caso como is_latest=false. Todo en una transacción atómica.
 *
 * Body esperado (JSON):
 *   {
 *     student_id: "PRL2526_001",
 *     case_id: "psicosocial_gestoria_v1",
 *     case_order: 1,                       // opcional
 *     vector_ejes: [                       // 5 ejes obligatorios
 *       { eje: "capacidad_analisis", puntuacion: 7.5 },
 *       { eje: "uso_marcos_teoricos", puntuacion: 6.0 },
 *       { eje: "criterio_intervencion", puntuacion: 8.0 },
 *       { eje: "deteccion_riesgos_criticos", puntuacion: 7.0 },
 *       { eje: "argumentacion_profesional", puntuacion: 6.5 }
 *     ],
 *     score_total: 70.0,
 *     validated_by: "jonas.agudo",         // opcional
 *     notes: "..."                          // opcional
 *   }
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

    // 2. Mapeo vector_ejes → columnas
    const ejesMap = {};
    for (const item of body.vector_ejes) {
        ejesMap[item.eje] = Number(item.puntuacion);
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
            const p = Number(item?.puntuacion);
            if (Number.isNaN(p) || p < 0 || p > 100) {
                errores.push(`Puntuación inválida en eje "${item?.eje}": ${item?.puntuacion}`);
            }
        }
    }

    const score = Number(body.score_total);
    if (Number.isNaN(score) || score < 0 || score > 100) {
        errores.push('score_total debe ser un número entre 0 y 100.');
    }

    return errores;
}
