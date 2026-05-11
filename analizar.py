"""
AVI School - Análisis longitudinal del alumno con IA
====================================================
Lee todo el historial del alumno desde Supabase (notas, anotaciones,
comunicaciones) y genera un análisis profundo con Gemini Flash.
Guarda el resultado en la tabla analisis_alumno.

Uso:
    python analizar.py                    # analiza ambos alumnos
    python analizar.py --alumno clemente  # solo Clemente
    python analizar.py --alumno raimundo  # solo Raimundo
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types
from supabase import create_client

load_dotenv()

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

ALUMNOS = [
    {"nombre": "Clemente Aravena", "curso": "6°D", "edad": 11},
    {"nombre": "Raimundo Aravena", "curso": "4°A", "edad": 9},
]

ANALISIS_PROMPT = """Eres un psicopedagogo escolar especializado en educación primaria chilena.
Analizas el perfil COMPLETO de un alumno basándote en su historial real de notas, conducta y comunicaciones del colegio.
Tu objetivo es ayudar a los padres (Manuel y Clau) a entender el estado actual de su hijo y qué acciones tomar.

ALUMNO: {nombre}
CURSO: {curso}, Colegio Georgian (Saint George), Chile
FECHA DEL ANÁLISIS: {fecha}
EDAD: {edad} años

══════════════════════════════════
HISTORIAL DE NOTAS (de más antiguo a más reciente)
══════════════════════════════════
{notas_texto}

══════════════════════════════════
HISTORIAL DE CONDUCTA (anotaciones de más antigua a más reciente)
══════════════════════════════════
{anotaciones_texto}

══════════════════════════════════
COMUNICACIONES Y EVENTOS RELEVANTES (últimos 60 días, del colegio)
══════════════════════════════════
{comunicaciones_texto}

══════════════════════════════════
PRÓXIMAS FECHAS Y EVENTOS
══════════════════════════════════
{fechas_texto}

Con base en todo lo anterior, genera un análisis profundo y accionable.
Sé específico con los datos reales — no generalices. Si hay pocas notas, di cuáles son.
Si hay anotaciones negativas, analiza el patrón.

Responde SOLO con este JSON válido (sin markdown, sin texto extra):

{{
  "resumen": "2-3 frases describiendo el estado actual integral del alumno, basado en los datos",
  "tendencia_academica": "mejorando|estable|descendiendo",
  "tendencia_conducta": "mejorando|estable|descendiendo",
  "nivel_alerta": "alto|medio|bajo",
  "analisis_academico": "párrafo detallado con las notas específicas, tendencia por asignatura, comparación con promedio del curso si disponible",
  "analisis_conducta": "párrafo con el patrón de anotaciones, qué tipo predomina, frecuencia, en qué asignaturas o contextos",
  "analisis_comunicaciones": "qué comunican los profesores, qué temas recurrentes aparecen, qué se espera del alumno",
  "fortalezas": ["fortaleza 1 específica con evidencia", "fortaleza 2"],
  "areas_atencion": ["área 1 con dato específico", "área 2"],
  "alertas": [
    {{"titulo": "título corto", "descripcion": "descripción con dato concreto", "prioridad": "alta|media|baja"}}
  ],
  "recomendaciones": [
    {{"accion": "qué hacer exactamente", "razon": "por qué, con dato del historial", "urgencia": "inmediata|esta_semana|este_mes"}}
  ],
  "prediccion": "basándote en las tendencias actuales, qué esperar en las próximas 4 semanas. Sé específico con asignaturas o eventos",
  "mensaje_motivacional": "mensaje positivo y realista para decirle al alumno (1 frase)"
}}"""


def _fmt_notas(notas: list) -> str:
    if not notas:
        return "(sin registros de notas)"
    lines = []
    by_asig: dict[str, list] = {}
    for n in notas:
        asig = n.get("asignatura", "?")
        if asig not in by_asig:
            by_asig[asig] = []
        by_asig[asig].append(n)
    for asig, ns in by_asig.items():
        notas_str = ", ".join(
            f"{n.get('nota', '?')} ({n.get('descripcion') or n.get('tipo', '')}, {(n.get('extraido_en') or '')[:10]})"
            for n in ns
        )
        prom = ns[-1].get("promedio_curso")
        prom_str = f" | Prom. curso: {prom}" if prom else ""
        lines.append(f"  {asig}: {notas_str}{prom_str}")
    return "\n".join(lines)


def _fmt_anotaciones(anotaciones: list) -> str:
    if not anotaciones:
        return "(sin registros de conducta)"
    lines = []
    for a in anotaciones:
        tipo = a.get("tipo", "observacion").upper()
        titulo = a.get("titulo") or ""
        desc = a.get("descripcion") or ""
        fecha = a.get("fecha") or ""
        asig = a.get("asignatura") or ""
        texto = titulo if titulo else desc
        if titulo and desc and desc != titulo:
            texto = f"{titulo} — {desc}"
        asig_str = f" [{asig}]" if asig else ""
        lines.append(f"  [{tipo}] {fecha}{asig_str}: {texto}")
    return "\n".join(lines)


def _fmt_comunicaciones(items: list) -> str:
    if not items:
        return "(sin comunicaciones relevantes)"
    lines = []
    for it in items:
        cat = it.get("categoria", "").upper()
        titulo = it.get("titulo", "")
        detalle = it.get("detalle", "")
        fecha = it.get("fecha", "")
        lines.append(f"  [{cat}] {fecha}: {titulo}\n    → {detalle}")
    return "\n".join(lines)


def _fmt_fechas(fechas: list) -> str:
    if not fechas:
        return "(sin próximas fechas)"
    lines = []
    for f in fechas:
        titulo = f.get("titulo", "")
        fecha = f.get("fecha_evento", "")
        asig = f.get("asignatura") or ""
        asig_str = f" [{asig}]" if asig else ""
        lines.append(f"  {fecha}{asig_str}: {titulo}")
    return "\n".join(lines)


def analizar_alumno(nombre: str, curso: str, edad: int, sb) -> dict:
    primer_nombre = nombre.split()[0]
    hoy = datetime.now().strftime("%Y-%m-%d")
    hace_60 = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d")

    print(f"\n[INFO] Cargando historial de {nombre}...")

    # Notas: todo el historial
    notas_res = (
        sb.table("notas")
        .select("asignatura, tipo, nota, promedio_curso, descripcion, extraido_en")
        .ilike("alumno", f"%{primer_nombre}%")
        .order("extraido_en", desc=False)
        .execute()
    )
    notas = notas_res.data or []
    print(f"  Notas: {len(notas)} registros")

    # Anotaciones: todo el historial
    anotaciones_res = (
        sb.table("anotaciones")
        .select("fecha, tipo, titulo, descripcion, asignatura")
        .ilike("alumno", f"%{primer_nombre}%")
        .order("fecha", desc=False)
        .execute()
    )
    anotaciones = anotaciones_res.data or []
    print(f"  Anotaciones: {len(anotaciones)} registros")

    # Digests: últimos 60 días — extraer ítems del alumno
    digests_res = (
        sb.table("digests")
        .select("resumen_ejecutivo, json_completo, created_at")
        .gte("created_at", hace_60 + "T00:00:00")
        .order("created_at", desc=False)
        .execute()
    )
    comunicaciones = []
    for d in (digests_res.data or []):
        fecha_digest = (d.get("created_at") or "")[:10]
        json_c = d.get("json_completo") or {}
        for cat in ["urgentes", "importantes", "informativos"]:
            for item in json_c.get(cat, []):
                titulo = item.get("titulo", "")
                detalle = item.get("detalle", "")
                if (primer_nombre.upper() in titulo.upper() or
                        primer_nombre.upper() in detalle.upper()):
                    comunicaciones.append({
                        "fecha": fecha_digest,
                        "categoria": cat,
                        "titulo": titulo,
                        "detalle": detalle[:300],
                    })
    print(f"  Comunicaciones relevantes: {len(comunicaciones)}")

    # Próximas fechas
    fechas_res = (
        sb.table("items_colegio")
        .select("titulo, fecha_evento, asignatura")
        .ilike("alumno", f"%{primer_nombre}%")
        .eq("categoria", "fecha_proxima")
        .gte("fecha_evento", hoy)
        .order("fecha_evento")
        .limit(10)
        .execute()
    )
    fechas = fechas_res.data or []
    print(f"  Próximas fechas: {len(fechas)}")

    # Build prompt
    prompt = ANALISIS_PROMPT.format(
        nombre=nombre,
        curso=curso,
        edad=edad,
        fecha=hoy,
        notas_texto=_fmt_notas(notas),
        anotaciones_texto=_fmt_anotaciones(anotaciones),
        comunicaciones_texto=_fmt_comunicaciones(comunicaciones),
        fechas_texto=_fmt_fechas(fechas),
    )

    print(f"[INFO] Llamando a Gemini ({GEMINI_MODEL}) para análisis de {nombre}...")
    client = genai.Client(api_key=GEMINI_API_KEY)
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.25,
            thinking_config=types.ThinkingConfig(thinking_budget=8000),
        ),
    )

    try:
        analisis = json.loads(response.text)
    except json.JSONDecodeError as e:
        print(f"[ERROR] JSON inválido: {e}")
        raw = Path(f"analisis_raw_{primer_nombre.lower()}_{datetime.now().strftime('%H%M%S')}.txt")
        raw.write_text(response.text, encoding="utf-8")
        print(f"  Raw guardado en: {raw}")
        return {}

    # Guardar en Supabase
    row = {
        "alumno": nombre,
        "generado_en": datetime.now().isoformat(),
        "resumen": analisis.get("resumen", ""),
        "tendencia_academica": analisis.get("tendencia_academica", "estable"),
        "tendencia_conducta": analisis.get("tendencia_conducta", "estable"),
        "nivel_alerta": analisis.get("nivel_alerta", "bajo"),
        "analisis_academico": analisis.get("analisis_academico", ""),
        "analisis_conducta": analisis.get("analisis_conducta", ""),
        "prediccion": analisis.get("prediccion", ""),
        "json_completo": analisis,
    }
    sb.table("analisis_alumno").insert(row).execute()
    print(f"[OK] Análisis de {nombre} guardado en Supabase")

    # Print resumen
    print(f"\n{'='*60}")
    print(f"ANÁLISIS: {nombre}")
    print(f"{'='*60}")
    print(f"Tendencia académica : {analisis.get('tendencia_academica', '?').upper()}")
    print(f"Tendencia conducta  : {analisis.get('tendencia_conducta', '?').upper()}")
    print(f"Nivel alerta        : {analisis.get('nivel_alerta', '?').upper()}")
    print(f"\nResumen: {analisis.get('resumen', '')}")
    alertas = analisis.get("alertas", [])
    if alertas:
        print(f"\nAlertas ({len(alertas)}):")
        for a in alertas:
            print(f"  [{a.get('prioridad','?').upper()}] {a.get('titulo')}: {a.get('descripcion')}")
    recomendaciones = analisis.get("recomendaciones", [])
    if recomendaciones:
        print(f"\nRecomendaciones ({len(recomendaciones)}):")
        for r in recomendaciones:
            print(f"  [{r.get('urgencia','?')}] {r.get('accion')}")
    print(f"\nPredicción: {analisis.get('prediccion', '')}")

    return analisis


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--alumno", choices=["clemente", "raimundo"],
                        help="Analizar solo este alumno")
    args = parser.parse_args()

    if not GEMINI_API_KEY:
        print("[ERROR] Falta GEMINI_API_KEY en .env")
        sys.exit(1)

    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not key:
        print("[ERROR] Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en .env")
        sys.exit(1)

    sb = create_client(url, key)

    alumnos = ALUMNOS
    if args.alumno:
        alumnos = [a for a in ALUMNOS if args.alumno in a["nombre"].lower()]

    for a in alumnos:
        analizar_alumno(a["nombre"], a["curso"], a["edad"], sb)

    print("\n[OK] Análisis completado.")


if __name__ == "__main__":
    main()
