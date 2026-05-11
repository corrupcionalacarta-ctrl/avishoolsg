-- Ejecutar en Supabase Dashboard > SQL Editor
-- https://supabase.com/dashboard/project/ltwzqmecxjweerkxudnj/sql

CREATE TABLE IF NOT EXISTS classroom_archivos (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alumno          text NOT NULL,
    archivo_nombre  text NOT NULL,
    archivo_path    text,
    asignatura      text,
    tipo_contenido  text,
    titulo_inferido text,
    unidad_tematica text,
    temas           jsonb DEFAULT '[]',
    conceptos_clave jsonb DEFAULT '[]',
    preguntas       jsonb DEFAULT '[]',
    nivel_dificultad text,
    resumen         text,
    fecha_probable  text,
    tiene_respuestas boolean DEFAULT false,
    analizado_en    timestamptz DEFAULT now(),
    UNIQUE (alumno, archivo_nombre)
);

CREATE INDEX IF NOT EXISTS idx_clasarch_alumno     ON classroom_archivos (alumno);
CREATE INDEX IF NOT EXISTS idx_clasarch_asignatura ON classroom_archivos (asignatura);
CREATE INDEX IF NOT EXISTS idx_clasarch_tipo       ON classroom_archivos (tipo_contenido);
