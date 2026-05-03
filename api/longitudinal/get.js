/* ============================================================================
 * DARABIA · LONGITUDINAL · GET
 * api/longitudinal/get.js
 *
 * Devuelve todas las evaluaciones validadas (is_latest=true) de un alumno,
 * ordenadas cronológicamente por timestamp ascendente para pintar la
 * evolución competencial en el dashboard.
 *
 * Uso:
 *   GET /api/longitudinal/get?student_id=PRL2526_001
 *
 * Respuesta:
 *   {
 *     ok: true,
 *     student_id: "PRL2526_001",
 *     count: 2,
 *     evaluaciones: [
 *       {
 *         id, student_id, case_id, case_order, timestamp,
 *         axis_analisis, axis_modelos, axis_intervencion,
 *         axis_riesgos, axis_argumentacion,
 *         score_total, validated_by, validated_at, notes
 *       },
 *       ...
 *     ]
 *   }
 * ============================================================================ */

import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'Solo GET.' });
    }

    const studentId = (req.query.student_id || '').toString().trim();

    if (!studentId) {
        return res.status(400).json({
            error: 'MISSING_PARAM',
            message: 'Falta query param obligatorio: student_id.'
        });
    }

    if (!process.env.DATABASE_URL) {
        return res.status(500).json({
            error: 'CONFIG_ERROR',
            message: 'DATABASE_URL no configurada en variables de entorno.'
        });
    }

    const sql = neon(process.env.DATABASE_URL);

    try {
        const filas = await sql`
            SELECT
                id,
                student_id,
                case_id,
                case_order,
                timestamp,
                status,
                vector_origen,
                axis_analisis,
                axis_modelos,
                axis_intervencion,
                axis_riesgos,
                axis_argumentacion,
                score_total,
                validated_by,
                validated_at,
                notes
            FROM evaluaciones_longitudinales
            WHERE student_id = ${studentId}
              AND is_latest = TRUE
              AND status = 'validated'
            ORDER BY timestamp ASC
        `;

        return res.status(200).json({
            ok: true,
            student_id: studentId,
            count: filas.length,
            evaluaciones: filas
        });

    } catch (err) {
        console.error('[LONGITUDINAL/GET] Error de lectura:', err);
        return res.status(500).json({
            error: 'DB_ERROR',
            message: err.message || 'Error desconocido al leer.'
        });
    }
}
