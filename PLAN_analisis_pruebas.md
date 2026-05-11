# Plan: Análisis de Pruebas Rendidas (Handwriting + Errores)

> Estado: **STAND BY** — planificado, pendiente de implementación
> Última actualización: 2026-05-11

---

## Visión

Cuando una prueba corregida vuelve del colegio, el apoderado toma una foto y la manda
por Telegram. El sistema la analiza contra la pauta real del profesor (ya disponible en
`classroom_archivos`), identifica errores pregunta por pregunta, analiza la letra y
produce recomendaciones de estudio. Todo visible en la app.

---

## Decisiones de diseño

### 1. Canal de entrada → **Telegram** (principal) + web (futuro)
El bot ya existe. Es el canal natural: el apoderado tiene la prueba en la mano, saca
foto, la manda al bot con un caption simple como `"prueba clemente matemática"`.
La web puede agregarse después como alternativa para subir PDFs escaneados.

### 2. Match con la pauta → **Semi-automático**
El sistema busca en `classroom_archivos` por asignatura + periodo.
- Si encuentra una sola pauta candidata → la usa directamente.
- Si hay varias → le pregunta al apoderado en Telegram cuál es (menú inline).
- Si no encuentra → analiza igual pero sin comparar con pauta, enfocándose en letra y patrones.

### 3. Almacenamiento de fotos → **Supabase Storage**
Ya está configurado en el proyecto. Carpeta: `pruebas/{alumno}/{asignatura}/`.
Gratis hasta 1GB — suficiente para años de fotos de pruebas.

### 4. Alumnos → **Clemente primero, Raimundo después**
Clemente (6°D) tiene más contenido ya analizado en `classroom_archivos`, así que el
match con pautas será más efectivo de entrada. El pipeline es idéntico para ambos.

### 5. Respuesta por Telegram → **Sí, resumen inmediato**
Al terminar el análisis, el bot responde en Telegram con un resumen tipo:

```
📝 Prueba Matemática — Clemente
Nota: 5.5 | 7 correctas / 10

✅ Bien: MCM, MCD, multiplicación
❌ Errores: Operaciones combinadas (2 preguntas) — tipo: procedimental
✏️ Letra: legibilidad 7/10 — irregular al final (posible cansancio)

💡 Recomendar: repasar prioridad de operaciones
→ Ver análisis completo en la app
```

---

## Arquitectura

```
ENTRADA
  Telegram bot recibe foto + caption
       │
       ▼
  test_intake.py
  ├── Detecta alumno y asignatura del caption (o pregunta)
  ├── Sube foto a Supabase Storage
  └── Busca pauta en classroom_archivos
       │
       ▼
  test_analyzer.py  (nuevo)
  ├── Input: foto (bytes) + pauta JSON + metadata
  ├── Gemini 2.5 Flash multimodal
  └── Output: JSON estructurado (ver schema)
       │
       ▼
  Supabase
  ├── pruebas_rendidas (registro de la prueba)
  └── analisis_respuestas (análisis Gemini)
       │
       ▼
  Telegram: resumen inmediato
  App /alumnos/[slug]: detalle completo
```

---

## Schema de base de datos

### `pruebas_rendidas`
```sql
CREATE TABLE pruebas_rendidas (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alumno          text NOT NULL,
    asignatura      text NOT NULL,
    fecha_prueba    date,
    nota_obtenida   numeric,
    foto_url        text,                    -- Supabase Storage URL
    pauta_id        uuid REFERENCES classroom_archivos(id),
    procesada       boolean DEFAULT false,
    creada_en       timestamptz DEFAULT now()
);
```

### `analisis_respuestas`
```sql
CREATE TABLE analisis_respuestas (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prueba_id       uuid REFERENCES pruebas_rendidas(id),
    alumno          text NOT NULL,
    asignatura      text,
    preguntas       jsonb DEFAULT '[]',     -- [{numero, correcta, tipo_error, descripcion}]
    resumen_errores jsonb,                  -- {conceptual: 2, procedimental: 1, descuido: 0, ...}
    analisis_letra  jsonb,                  -- {legibilidad: 7, presion, consistencia, observaciones}
    patron_errores  text,
    preguntas_blanco int DEFAULT 0,
    recomendaciones jsonb DEFAULT '[]',
    resumen_telegram text,                  -- texto listo para mandar por Telegram
    generado_en     timestamptz DEFAULT now()
);
```

---

## Prompt Gemini (borrador)

```
Eres un experto pedagogo y grafólogo especializado en educación básica chilena.

El alumno es {nombre}, {curso}, Colegio Georgian (Saint George).

TIENES:
1. Foto de la prueba rendida por el alumno (con respuestas manuscritas y correcciones del profesor)
2. Pauta con respuestas correctas: {pauta_json}

ANALIZA y responde en JSON con esta estructura exacta:
{
  "preguntas": [
    {"numero": 1, "correcta": true, "tipo_error": null, "descripcion": null},
    {"numero": 2, "correcta": false, "tipo_error": "conceptual|procedimental|comprension|descuido", "descripcion": "..."}
  ],
  "resumen_errores": {"conceptual": 0, "procedimental": 0, "comprension": 0, "descuido": 0},
  "analisis_letra": {
    "legibilidad": 7,
    "presion": "normal|alta|baja",
    "consistencia": "uniforme|irregular_inicio|irregular_final|muy_irregular",
    "inclinacion": "vertical|derecha|izquierda",
    "observaciones": "..."
  },
  "patron_errores": "descripción del patrón principal observado",
  "preguntas_blanco": 0,
  "concentracion_errores": "inicio|medio|final|distribuido",
  "recomendaciones": ["...", "..."],
  "resumen_telegram": "texto corto para mensaje Telegram al apoderado"
}
```

---

## UI en la app

### `/alumnos/[slug]` — nuevo tab "Pruebas"
```
Clemente  ·  6°D
[Resumen] [Notas] [Pruebas ←nuevo] [Tareas]

PRUEBAS RENDIDAS
────────────────
📝 Matemática · 15 may · Nota: 5.5
   7/10 correctas · 2 errores conceptuales
   ► Ver detalle

📝 Ciencias · 8 may · Nota: 6.2
   9/10 correctas · 1 descuido
   ► Ver detalle
```

### `/alumnos/[slug]/pruebas/[id]` — detalle
```
Matemática — Repaso Control 1
Clemente · 15 mayo · Nota: 5.5

PREGUNTA POR PREGUNTA
  ✓ P1  Operaciones combinadas
  ✓ P2  Factores y divisores
  ✗ P3  MCM ← Error conceptual: confundió MCM con MCD
  ✓ P4  ...

ANÁLISIS DE LETRA
  Legibilidad: ●●●●●●●○○○ 7/10
  Consistencia: irregular en la parte final (cansancio)
  Presión: normal

PATRÓN
  Los errores se concentran en preguntas 5-8 (segunda mitad).
  Probable causa: falta de tiempo o concentración.

RECOMENDACIONES
  → Repasar MCM vs MCD con ejercicios
  → Practicar administración del tiempo en prueba
```

---

## Archivos a crear

| Archivo | Descripción |
|---|---|
| `test_intake.py` | Recibe foto desde Telegram, sube a Storage, busca pauta |
| `test_analyzer.py` | Análisis Gemini multimodal foto + pauta |
| `migrate_pruebas.sql` | Crear tablas `pruebas_rendidas` y `analisis_respuestas` |
| `app/alumnos/[slug]/pruebas/page.tsx` | Lista de pruebas rendidas |
| `app/alumnos/[slug]/pruebas/[id]/page.tsx` | Detalle con análisis completo |
| Modificar `app/api/telegram/route.ts` | Manejar mensajes con foto |

---

## Dependencias ya resueltas

- ✅ Gemini 2.5 Flash multimodal (ya usado en `drive_analyzer.py`)
- ✅ Bot Telegram activo (`/api/telegram/route.ts`)
- ✅ Supabase Storage (configurado en el proyecto)
- ✅ Pautas disponibles en `classroom_archivos` (25 archivos analizados)
- ✅ Notas en `schoolnet_notas` para cruzar
- ✅ Pipeline matutino en `run_all.py` (para análisis batch si se necesita)
