"""
tutor.py - Tutor IA para Clemente basado en el material real del colegio
=========================================================================
Lee los análisis de los archivos Drive y el contenido de Supabase para
responder preguntas de cualquier materia del 6to básico.

Usa Gemini con contexto completo de:
  - Archivos analizados (pruebas, guías, pautas, presentaciones)
  - Notas del alumno (schoolnet_notas)
  - Tareas pendientes (classroom)
  - Calendario escolar (items_colegio)

Modos:
    python tutor.py                     # chat interactivo
    python tutor.py --materia mat       # enfocado en matemática
    python tutor.py --resumen           # resumen de situación actual
    python tutor.py --prueba            # preparar la próxima prueba
"""

import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

OUTPUT_DIR   = Path(os.getenv("OUTPUT_DIR", "."))
DOWNLOAD_DIR = OUTPUT_DIR / "drive_downloads"
GEMINI_KEY   = (os.getenv("GEMINI_API_KEY") or "").strip()
GEMINI_MODEL = (os.getenv("GEMINI_MODEL") or "gemini-2.5-flash").strip()

ALUMNO_NOMBRE = (os.getenv("ALUMNO_1_NOMBRE") or "Clemente").strip()
ALUMNO_SLUG   = ALUMNO_NOMBRE.split()[0].lower()
HOY           = date.today().isoformat()


def _safe_print(msg: str):
    sys.stdout.buffer.write((msg + "\n").encode("utf-8", "replace"))
    sys.stdout.buffer.flush()


# ─────────────────────────────────────────────────────────────────────────────
# Carga de contexto
# ─────────────────────────────────────────────────────────────────────────────

def load_analyses(slug: str, materia_filter: str = "") -> list[dict]:
    """Carga todos los análisis de archivos del alumno."""
    analysis_dir = OUTPUT_DIR / f"analysis_{slug}"
    if not analysis_dir.exists():
        return []

    results = []
    for f in sorted(analysis_dir.iterdir()):
        if not f.suffix == ".json":
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            a = data.get("analisis", data)
            if materia_filter:
                asig = (a.get("asignatura") or "").lower()
                if materia_filter.lower() not in asig:
                    continue
            a["_archivo"] = data.get("archivo", f.stem)
            results.append(a)
        except Exception:
            continue
    return results


def load_supabase_context(alumno: str, materia_filter: str = "") -> dict:
    """Carga contexto de Supabase: notas, tareas, calendario."""
    url = (os.getenv("SUPABASE_URL") or "").strip()
    key = (os.getenv("SUPABASE_SERVICE_KEY") or "").strip()
    context = {"notas": [], "tareas": [], "calendar": [], "schoolnet": []}

    if not url or not key:
        return context

    try:
        from supabase import create_client
        sb = create_client(url, key)

        # Notas recientes
        try:
            r = sb.table("schoolnet_notas").select("*").eq("alumno", alumno).order("fecha", desc=True).limit(50).execute()
            notas = r.data or []
            if materia_filter:
                notas = [n for n in notas if materia_filter.lower() in (n.get("asignatura") or "").lower()]
            context["notas"] = notas
        except Exception:
            pass

        # Tareas pendientes
        try:
            r = sb.table("classroom").select("*").eq("alumno", alumno).in_("estado", ["pendiente", "atrasado"]).order("fecha_entrega").limit(30).execute()
            tareas = r.data or []
            if materia_filter:
                tareas = [t for t in tareas if materia_filter.lower() in (t.get("curso") or "").lower()]
            context["tareas"] = tareas
        except Exception:
            pass

        # Próximas fechas
        try:
            r = sb.table("items_colegio").select("*").eq("alumno", alumno).eq("categoria", "fecha_proxima").gte("fecha_evento", HOY).order("fecha_evento").limit(20).execute()
            context["calendar"] = r.data or []
        except Exception:
            pass

    except Exception as e:
        pass

    return context


def build_context_text(analyses: list[dict], sb_ctx: dict, materia_filter: str = "") -> str:
    """Construye el texto de contexto para el prompt del tutor."""
    parts = []
    parts.append(f"=== CONTEXTO DEL ALUMNO: {ALUMNO_NOMBRE} (6to básico, {HOY}) ===\n")

    # Próximas pruebas / fechas importantes
    if sb_ctx.get("calendar"):
        parts.append("PRÓXIMAS FECHAS:")
        for ev in sb_ctx["calendar"][:10]:
            parts.append(f"  - {ev.get('fecha_evento', '?')}: {ev.get('titulo', '?')} ({ev.get('asignatura', '')})")
        parts.append("")

    # Notas recientes
    if sb_ctx.get("notas"):
        parts.append("NOTAS RECIENTES:")
        for n in sb_ctx["notas"][:15]:
            nota = n.get("nota", "")
            partes = n.get("n_partes", "")
            parts.append(f"  - {n.get('asignatura','?')} | {n.get('tipo_evaluacion','?')} | Nota: {nota} ({partes})")
        parts.append("")

    # Tareas pendientes
    if sb_ctx.get("tareas"):
        parts.append("TAREAS PENDIENTES EN CLASSROOM:")
        for t in sb_ctx["tareas"][:10]:
            parts.append(f"  - [{t.get('estado','?').upper()}] {t.get('titulo','?')} ({t.get('curso','?')}) — {t.get('fecha_entrega','sin fecha')}")
        parts.append("")

    # Material analizado
    if analyses:
        # Separar por tipo
        pruebas  = [a for a in analyses if a.get("tipo_contenido") in ("prueba", "guia")]
        pautas   = [a for a in analyses if a.get("tipo_contenido") == "pauta"]
        material = [a for a in analyses if a.get("tipo_contenido") in ("material", "ejercicio", "temario", "otro")]

        if pruebas:
            parts.append(f"PRUEBAS Y GUÍAS DISPONIBLES ({len(pruebas)}):")
            for a in pruebas:
                temas_str = ", ".join(a.get("temas", [])[:5])
                n_preg = len(a.get("preguntas_o_ejercicios", []))
                parts.append(f"  [{a.get('tipo_contenido','?').upper()}] {a['_archivo']}")
                parts.append(f"    Asignatura: {a.get('asignatura','?')} | Unidad: {a.get('unidad_tematica','?')}")
                parts.append(f"    Temas: {temas_str}")
                parts.append(f"    {n_preg} preguntas/ejercicios")
                parts.append(f"    Resumen: {a.get('resumen','')}")

                # Incluir preguntas (hasta 20 por archivo)
                preguntas = a.get("preguntas_o_ejercicios", [])[:20]
                if preguntas:
                    parts.append("    Preguntas:")
                    for p in preguntas:
                        enun = (p.get("enunciado") or "")[:200]
                        parts.append(f"      {p.get('numero','?')}. [{p.get('tipo','?')}] {enun}")
                parts.append("")

        if pautas:
            parts.append(f"PAUTAS / RESPUESTAS CORRECTAS ({len(pautas)}):")
            for a in pautas:
                parts.append(f"  [PAUTA] {a['_archivo']}")
                parts.append(f"    Unidad: {a.get('unidad_tematica','?')}")
                parts.append(f"    Resumen: {a.get('resumen','')}")
                preguntas = a.get("preguntas_o_ejercicios", [])[:30]
                if preguntas:
                    parts.append("    Respuestas:")
                    for p in preguntas:
                        enun = (p.get("enunciado") or "")[:200]
                        parts.append(f"      {p.get('numero','?')}. {enun}")
                parts.append("")

        if material:
            parts.append(f"MATERIAL DEL PROFESOR ({len(material)}):")
            for a in material:
                temas_str = ", ".join(a.get("temas", [])[:4])
                parts.append(f"  [{a.get('tipo_contenido','?').upper()}] {a['_archivo']}: {temas_str}")
            parts.append("")

    return "\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Chat con Gemini
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """Eres un tutor privado experto en el currículo chileno de 6to básico.
Tu alumno es {alumno_nombre} y tienes acceso a todo su material real del colegio: guías, pruebas, pautas y presentaciones de sus profesores.

Reglas:
- Explica de forma clara y amena, como si hablaras con un niño de 11-12 años
- Usa ejemplos concretos y contextualizados con el material que tiene el alumno
- Si hay una pauta disponible, puedes usarla para verificar respuestas
- Si te preguntan sobre una materia específica, enfócate en los temas que el alumno tiene que estudiar
- Cuando detectes que una prueba se acerca, prioriza ese contenido
- Habla en español chileno natural
- Sé alentador pero honesto sobre las dificultades
"""

CONTEXTO_INICIAL = """
Tienes el siguiente contexto actualizado del alumno:

{context}

Usa este contexto para responder de forma precisa y personalizada.
Si el alumno pregunta sobre un tema, busca si hay material disponible y úsalo.
"""


def chat_with_tutor(materia_filter: str = "", modo: str = "chat"):
    """Sesión de chat interactiva con el tutor."""
    if not GEMINI_KEY:
        _safe_print("[ERROR] GEMINI_API_KEY no configurada")
        return

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=GEMINI_KEY)

    # Cargar contexto
    _safe_print("[...] Cargando contexto del alumno...")
    analyses = load_analyses(ALUMNO_SLUG, materia_filter)
    sb_ctx   = load_supabase_context(ALUMNO_NOMBRE, materia_filter)
    context_text = build_context_text(analyses, sb_ctx, materia_filter)

    _safe_print(f"[OK] {len(analyses)} archivos analizados cargados")
    if sb_ctx.get("notas"):
        _safe_print(f"[OK] {len(sb_ctx['notas'])} notas de SchoolNet cargadas")
    if sb_ctx.get("calendar"):
        _safe_print(f"[OK] {len(sb_ctx['calendar'])} eventos en calendario")
    _safe_print("")

    system = SYSTEM_PROMPT.format(alumno_nombre=ALUMNO_NOMBRE)
    context_msg = CONTEXTO_INICIAL.format(context=context_text)

    # Mensaje de bienvenida según modo
    if modo == "prueba":
        # Buscar próxima prueba
        proxima = None
        for ev in sb_ctx.get("calendar", []):
            if "prueba" in (ev.get("titulo") or "").lower():
                proxima = ev
                break

        if proxima:
            intro = f"Hola! Veo que tienes {proxima.get('titulo','')} el {proxima.get('fecha_evento','')}. Vamos a prepararnos juntos. ¿Por qué tema quieres empezar?"
        else:
            intro = f"Hola {ALUMNO_NOMBRE.split()[0]}! Vamos a repasar el material para tus próximas pruebas. ¿Qué materia quieres trabajar?"
    elif modo == "resumen":
        intro = f"Dame un segundo mientras analizo tu situación académica actual..."
    else:
        subject_hint = f" de {materia_filter}" if materia_filter else ""
        intro = f"Hola {ALUMNO_NOMBRE.split()[0]}! Soy tu tutor{subject_hint}. ¿En qué te puedo ayudar hoy?"

    _safe_print(f"\n{'─'*60}")
    _safe_print(f"TUTOR IA — {ALUMNO_NOMBRE}")
    if materia_filter:
        _safe_print(f"Enfoque: {materia_filter}")
    _safe_print(f"{'─'*60}\n")

    # Historial de conversación
    history: list[types.Content] = []

    # Mensaje inicial de contexto (rol usuario, invisible para el alumno)
    history.append(types.Content(
        role="user",
        parts=[types.Part.from_text(text=context_msg)]
    ))
    history.append(types.Content(
        role="model",
        parts=[types.Part.from_text(text="Entendido. Tengo el contexto completo del alumno y estoy listo para ayudar.")]
    ))

    if modo == "resumen":
        # Generar resumen automático
        resumen_prompt = f"""Con el contexto del alumno que tienes, genera un resumen ejecutivo para el apoderado (padre) que incluya:
1. Próximas pruebas y fechas críticas
2. Estado de las tareas pendientes
3. Notas recientes destacadas (buenas y malas)
4. Recomendaciones de estudio para esta semana
5. Materiales disponibles que debería revisar

Sé directo y útil. Habla al apoderado de forma respetuosa."""

        history.append(types.Content(role="user", parts=[types.Part.from_text(text=resumen_prompt)]))
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            config=types.GenerateContentConfig(system_instruction=system),
            contents=history,
        )
        _safe_print(f"\nTUTOR:\n{response.text}\n")
        return

    # Chat interactivo
    _safe_print(f"TUTOR: {intro}\n")
    _safe_print("(Escribe 'salir' para terminar)\n")

    while True:
        try:
            user_input = input("TÚ: ").strip()
        except (EOFError, KeyboardInterrupt):
            _safe_print("\n[Sesión terminada]")
            break

        if not user_input:
            continue
        if user_input.lower() in ("salir", "exit", "quit", "bye", "chao"):
            _safe_print("\nTUTOR: ¡Hasta luego! Sigue estudiando con dedicación.")
            break

        history.append(types.Content(
            role="user",
            parts=[types.Part.from_text(text=user_input)]
        ))

        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                config=types.GenerateContentConfig(system_instruction=system),
                contents=history,
            )
            reply = response.text
        except Exception as e:
            reply = f"[ERROR] No pude responder: {e}"

        history.append(types.Content(
            role="model",
            parts=[types.Part.from_text(text=reply)]
        ))

        _safe_print(f"\nTUTOR: {reply}\n")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Tutor IA para Clemente")
    parser.add_argument("--materia", "-m", default="", help="Filtrar por materia (ej: Matemática, Ciencias)")
    parser.add_argument("--resumen", action="store_true", help="Generar resumen de situación académica")
    parser.add_argument("--prueba",  action="store_true", help="Modo preparación de prueba")
    args = parser.parse_args()

    modo = "resumen" if args.resumen else "prueba" if args.prueba else "chat"
    chat_with_tutor(materia_filter=args.materia, modo=modo)


if __name__ == "__main__":
    main()
