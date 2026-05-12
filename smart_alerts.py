"""
AVI School - Alertas inteligentes y planificador de estudio
============================================================
Genera alertas proactivas basadas en el cruce de datos de los alumnos:

  1. Semáforo de riesgo: nota baja + prueba próxima + tareas atrasadas
  2. Semana pesada: 3+ pruebas en 7 días
  3. Plan semanal de estudio (Gemini): qué estudiar esta semana y cuánto
  4. Informe mensual: resumen ejecutivo del mes para apoderados

Uso:
    python smart_alerts.py --riesgo          # check de riesgo y envia alerta si hay
    python smart_alerts.py --semana          # detecta semana pesada
    python smart_alerts.py --plan            # genera plan semanal de estudio
    python smart_alerts.py --informe         # informe del mes en curso
    python smart_alerts.py --informe 2026-04 # informe de un mes específico
    python smart_alerts.py --all             # corre todo (para el pipeline morning)
"""

import json
import os
import re
import sys
from datetime import datetime, timedelta, date

import requests
from dotenv import load_dotenv
from google import genai
from google.genai import types
from supabase import create_client

load_dotenv()

GEMINI_KEY   = (os.getenv("GEMINI_API_KEY") or "").strip()
GEMINI_MODEL = (os.getenv("GEMINI_MODEL") or "gemini-2.5-flash").strip()
BOT_TOKEN    = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
CHAT_ID      = (os.getenv("TELEGRAM_CHAT_ID") or "").strip()

ALUMNOS = [
    {"nombre": "Clemente Aravena", "slug": "clemente", "curso": "6°D"},
    {"nombre": "Raimundo Aravena", "slug": "raimundo",  "curso": "4°A"},
]

_sb = None
def get_sb():
    global _sb
    if _sb is None:
        _sb = create_client(
            os.getenv("SUPABASE_URL", ""),
            os.getenv("SUPABASE_SERVICE_KEY", ""),
        )
    return _sb


def log(msg: str):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def send_telegram(msg: str, parse_mode: str = "HTML") -> bool:
    if not BOT_TOKEN or not CHAT_ID:
        log("[WARN] Telegram no configurado, imprimiendo mensaje:")
        print(msg)
        return False
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            json={"chat_id": CHAT_ID, "text": msg, "parse_mode": parse_mode},
            timeout=15,
        )
        return r.status_code == 200
    except Exception as e:
        log(f"[ERROR] Telegram: {e}")
        return False


def gemini_text(prompt: str, temperature: float = 0.4) -> str:
    client = genai.Client(api_key=GEMINI_KEY)
    resp = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=3000,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    raw = ""
    if resp.candidates:
        for part in resp.candidates[0].content.parts:
            if hasattr(part, "text") and part.text:
                raw += part.text
    return raw.strip() or (resp.text or "").strip()


# ─────────────────────────────────────────────────────────────────────────────
# 1. SEMÁFORO DE RIESGO
# ─────────────────────────────────────────────────────────────────────────────

def check_riesgo(notify: bool = True) -> list[dict]:
    """
    Detecta situaciones de riesgo por alumno/asignatura:
    - Nota bajo 5.0 + prueba en los próximos 7 días
    - 2+ tareas atrasadas en la misma asignatura
    - 3+ anotaciones negativas en los últimos 14 días

    Devuelve lista de alertas y opcionalmente envía a Telegram.
    """
    sb  = get_sb()
    hoy = date.today().isoformat()
    en7 = (date.today() + timedelta(days=7)).isoformat()
    hace14 = (date.today() - timedelta(days=14)).isoformat()

    alertas_globales = []

    for alumno in ALUMNOS:
        nombre = alumno["nombre"]
        slug   = alumno["slug"]
        alertas = []

        # Notas por asignatura (promedios)
        notas_r = sb.table("notas").select(
            "asignatura, nota, tipo"
        ).ilike("alumno", f"%{slug}%").execute().data or []
        promedios = {n["asignatura"]: n["nota"] for n in notas_r if n.get("tipo") == "promedio" and n.get("nota")}

        # Próximas pruebas/controles (7 días)
        fechas_r = sb.table("items_colegio").select(
            "titulo, fecha_evento, asignatura"
        ).eq("categoria", "fecha_proxima").gte("fecha_evento", hoy).lte(
            "fecha_evento", en7
        ).or_(f"alumno.ilike.%{slug}%,alumno.is.null").execute().data or []

        pruebas_proximas = [
            f for f in fechas_r
            if re.search(r"prueba|control|evaluaci", f.get("titulo", ""), re.I)
        ]

        # Tareas atrasadas
        tareas_r = sb.table("classroom").select(
            "curso, titulo, estado, fecha_entrega"
        ).ilike("alumno", f"%{slug}%").eq("estado", "atrasado").execute().data or []

        # Anotaciones negativas recientes
        anot_r = sb.table("anotaciones").select(
            "tipo, titulo, asignatura, fecha"
        ).ilike("alumno", f"%{slug}%").eq("tipo", "negativa").gte(
            "fecha", hace14
        ).execute().data or []

        # ── Regla 1: nota baja + prueba próxima ──────────────────────────────
        for prueba in pruebas_proximas:
            asig = prueba.get("asignatura") or ""
            # Buscar nota de esa asignatura
            nota = None
            for asig_key, val in promedios.items():
                if asig.lower()[:4] in asig_key.lower() or asig_key.lower()[:4] in asig.lower():
                    nota = val
                    break

            dias = (datetime.strptime(prueba["fecha_evento"], "%Y-%m-%d").date() - date.today()).days
            if nota is not None and nota < 5.0:
                alertas.append({
                    "tipo": "riesgo_nota_prueba",
                    "prioridad": "alta",
                    "titulo": f"Nota baja + {prueba['titulo']}",
                    "detalle": f"{asig or 'asignatura'}: promedio {nota} · prueba en {dias} día{'s' if dias != 1 else ''}",
                    "asignatura": asig,
                })
            elif nota is not None and nota < 5.5:
                alertas.append({
                    "tipo": "riesgo_nota_prueba",
                    "prioridad": "media",
                    "titulo": f"Nota ajustada + {prueba['titulo']}",
                    "detalle": f"{asig or 'asignatura'}: promedio {nota} · prueba en {dias} día{'s' if dias != 1 else ''}",
                    "asignatura": asig,
                })

        # ── Regla 2: 2+ tareas atrasadas ─────────────────────────────────────
        if len(tareas_r) >= 2:
            alertas.append({
                "tipo": "tareas_atrasadas",
                "prioridad": "alta" if len(tareas_r) >= 3 else "media",
                "titulo": f"{len(tareas_r)} tareas atrasadas en Classroom",
                "detalle": ", ".join(t["titulo"][:30] for t in tareas_r[:3]),
                "asignatura": None,
            })

        # ── Regla 3: 3+ anotaciones negativas en 14 días ─────────────────────
        if len(anot_r) >= 3:
            alertas.append({
                "tipo": "conducta",
                "prioridad": "alta" if len(anot_r) >= 4 else "media",
                "titulo": f"{len(anot_r)} anotaciones negativas en 14 días",
                "detalle": " | ".join(a.get("titulo", "")[:40] for a in anot_r[:3]),
                "asignatura": None,
            })

        if alertas:
            alertas_globales.append({"alumno": nombre, "alertas": alertas})
            log(f"[RIESGO] {nombre}: {len(alertas)} alerta(s)")

    # ── Enviar a Telegram ─────────────────────────────────────────────────────
    if notify and alertas_globales:
        lineas = ["🚨 <b>ALERTA ACADÉMICA</b>\n"]
        for item in alertas_globales:
            nombre_corto = item["alumno"].split()[0]
            lineas.append(f"<b>{nombre_corto}</b>")
            for a in item["alertas"]:
                emoji = "🔴" if a["prioridad"] == "alta" else "🟡"
                lineas.append(f"{emoji} <b>{a['titulo']}</b>")
                lineas.append(f"   {a['detalle']}")
            lineas.append("")
        lineas.append("→ Abre la app para ver el detalle completo")
        send_telegram("\n".join(lineas))
    elif notify:
        log("[RIESGO] Sin alertas críticas hoy")

    return alertas_globales


# ─────────────────────────────────────────────────────────────────────────────
# 2. DETECTOR DE SEMANA PESADA
# ─────────────────────────────────────────────────────────────────────────────

def check_semana_pesada(notify: bool = True) -> list[dict]:
    """
    Detecta si algún alumno tiene 3+ evaluaciones en los próximos 7 días.
    Avisa con anticipación (ideal correr el viernes para la semana siguiente).
    """
    sb  = get_sb()
    hoy = date.today().isoformat()
    en7 = (date.today() + timedelta(days=7)).isoformat()

    resultados = []

    for alumno in ALUMNOS:
        nombre = alumno["nombre"]
        slug   = alumno["slug"]

        fechas_r = sb.table("items_colegio").select(
            "titulo, fecha_evento, asignatura"
        ).eq("categoria", "fecha_proxima").gte("fecha_evento", hoy).lte(
            "fecha_evento", en7
        ).or_(f"alumno.ilike.%{slug}%,alumno.is.null").execute().data or []

        evaluaciones = [
            f for f in fechas_r
            if re.search(r"prueba|control|evaluaci|disertaci|presentaci", f.get("titulo", ""), re.I)
        ]

        if len(evaluaciones) >= 3:
            resultados.append({"alumno": nombre, "evaluaciones": evaluaciones})
            log(f"[SEMANA PESADA] {nombre}: {len(evaluaciones)} evaluaciones en 7 días")

    if notify and resultados:
        lineas = ["📅 <b>SEMANA PESADA</b>\n"]
        for item in resultados:
            nombre_corto = item["alumno"].split()[0]
            lineas.append(f"<b>{nombre_corto}</b> tiene {len(item['evaluaciones'])} evaluaciones esta semana:")
            for ev in item["evaluaciones"]:
                lineas.append(f"  📝 {ev['fecha_evento']}: {ev['titulo']}"
                              + (f" [{ev['asignatura']}]" if ev.get("asignatura") else ""))
            lineas.append("")
        lineas.append("💡 Planifica el estudio con anticipación")
        send_telegram("\n".join(lineas))
    elif notify:
        log("[SEMANA] Sin semana pesada detectada")

    return resultados


# ─────────────────────────────────────────────────────────────────────────────
# 3. PLAN SEMANAL DE ESTUDIO
# ─────────────────────────────────────────────────────────────────────────────

def generar_plan_semanal(notify: bool = True) -> str:
    """
    Genera con Gemini un plan de estudio para la semana entrante.
    Considera: próximas pruebas, notas débiles, tareas pendientes y material disponible.
    """
    sb  = get_sb()
    hoy = date.today().isoformat()
    en14 = (date.today() + timedelta(days=14)).isoformat()

    # Recopilar contexto de ambos alumnos
    contexto_partes = [f"Hoy es {hoy} ({date.today().strftime('%A')}). Semana escolar en Chile.\n"]

    for alumno in ALUMNOS:
        nombre = alumno["nombre"]
        slug   = alumno["slug"]
        curso  = alumno["curso"]

        # Notas
        notas_r = sb.table("notas").select(
            "asignatura, nota, tipo"
        ).ilike("alumno", f"%{slug}%").execute().data or []
        promedios = [(n["asignatura"], n["nota"]) for n in notas_r if n.get("tipo") == "promedio" and n.get("nota")]

        # Próximas evaluaciones
        fechas_r = sb.table("items_colegio").select(
            "titulo, fecha_evento, asignatura"
        ).eq("categoria", "fecha_proxima").gte("fecha_evento", hoy).lte(
            "fecha_evento", en14
        ).or_(f"alumno.ilike.%{slug}%,alumno.is.null").order("fecha_evento").execute().data or []

        # Tareas pendientes
        tareas_r = sb.table("classroom").select(
            "curso, titulo, fecha_entrega, estado"
        ).ilike("alumno", f"%{slug}%").in_("estado", ["pendiente", "atrasado"]).order(
            "fecha_entrega"
        ).limit(10).execute().data or []

        # Material analizado disponible
        archivos_r = sb.table("classroom_archivos").select(
            "asignatura, tipo_contenido, titulo_inferido, temas"
        ).ilike("alumno", f"%{nombre.split()[0]}%").in_(
            "tipo_contenido", ["guia", "prueba", "pauta"]
        ).execute().data or []

        ctx = f"\n--- {nombre} ({curso}) ---\n"
        if promedios:
            ctx += "Notas actuales:\n"
            for asig, nota in sorted(promedios, key=lambda x: x[1]):
                ctx += f"  {asig}: {nota}\n"
        if fechas_r:
            ctx += "Próximas evaluaciones (14 días):\n"
            for f in fechas_r:
                ctx += f"  {f['fecha_evento']}: {f['titulo']}"
                if f.get("asignatura"): ctx += f" [{f['asignatura']}]"
                ctx += "\n"
        if tareas_r:
            ctx += f"Tareas pendientes/atrasadas: {len(tareas_r)}\n"
            for t in tareas_r[:5]:
                ctx += f"  [{t['estado'].upper()}] {t['titulo'][:50]} — {t.get('fecha_entrega','?')}\n"
        if archivos_r:
            ctx += f"Material disponible para estudiar ({len(archivos_r)} archivos analizados por IA)\n"
        contexto_partes.append(ctx)

    contexto = "\n".join(contexto_partes)

    prompt = f"""Eres un coach educativo experto en gestión del tiempo para familias chilenas con hijos en educación básica.

{contexto}

GENERA un plan de estudio para la semana entrante (lunes a viernes).
El plan es para Manuel y Clau, apoderados que quieren organizar el tiempo de estudio de sus hijos después del colegio.

FORMATO DEL PLAN (usa emojis y formato claro para Telegram, sin markdown complejo):

📚 PLAN DE ESTUDIO — SEMANA DEL [FECHA INICIO]

[Para cada alumno que tenga algo que estudiar]:

👦 [Nombre]:
  Lun: [qué estudiar] ([tiempo estimado])
  Mar: [qué estudiar] ([tiempo estimado])
  ...

⚡ PRIORIDADES:
  [máximo 3 prioridades críticas]

💡 CONSEJO DE LA SEMANA:
  [un consejo pedagógico concreto y accionable]

Reglas:
- Máximo 1.5 horas de estudio por niño por día entre semana
- Prioriza asignaturas con nota bajo 5.5 y prueba próxima
- Incluye tareas pendientes urgentes
- Si no hay nada urgente para un alumno, dílo brevemente
- Habla directo al apoderado, tono cálido y práctico
"""

    log("[PLAN] Generando plan semanal con Gemini...")
    plan = gemini_text(prompt, temperature=0.5)
    log(f"[PLAN] Generado ({len(plan)} chars)")

    if notify:
        send_telegram(plan, parse_mode="HTML")

    return plan


# ─────────────────────────────────────────────────────────────────────────────
# 4. INFORME MENSUAL
# ─────────────────────────────────────────────────────────────────────────────

def generar_informe_mensual(mes: str | None = None, notify: bool = True) -> str:
    """
    Genera un informe ejecutivo del mes para los apoderados.
    mes: "2026-05" (default: mes actual)
    """
    sb = get_sb()

    if not mes:
        mes = date.today().strftime("%Y-%m")

    try:
        anio, m = int(mes[:4]), int(mes[5:7])
    except (ValueError, IndexError):
        anio, m = date.today().year, date.today().month

    inicio_mes = date(anio, m, 1).isoformat()
    if m == 12:
        fin_mes = date(anio + 1, 1, 1).isoformat()
    else:
        fin_mes = date(anio, m + 1, 1).isoformat()

    nombre_mes = date(anio, m, 1).strftime("%B %Y").capitalize()
    log(f"[INFORME] Generando informe de {nombre_mes}...")

    contexto_partes = [f"Informe mensual: {nombre_mes}\n"]

    for alumno in ALUMNOS:
        nombre = alumno["nombre"]
        slug   = alumno["slug"]
        curso  = alumno["curso"]

        # Notas del mes
        notas_r = sb.table("notas").select(
            "asignatura, nota, tipo, descripcion, fecha"
        ).ilike("alumno", f"%{slug}%").execute().data or []

        # Anotaciones del mes
        anot_r = sb.table("anotaciones").select(
            "tipo, titulo, descripcion, fecha, asignatura"
        ).ilike("alumno", f"%{slug}%").gte("fecha", inicio_mes).lt(
            "fecha", fin_mes
        ).order("fecha").execute().data or []

        # Tareas entregadas vs atrasadas
        tareas_r = sb.table("classroom").select(
            "curso, titulo, estado, calificacion, fecha_entrega"
        ).ilike("alumno", f"%{slug}%").execute().data or []

        entregadas = [t for t in tareas_r if t.get("estado") in ("entregado", "calificado", "devuelto")]
        atrasadas  = [t for t in tareas_r if t.get("estado") == "atrasado"]
        pendientes = [t for t in tareas_r if t.get("estado") == "pendiente"]

        # Promedios actuales
        promedios = [(n["asignatura"], n["nota"]) for n in notas_r if n.get("tipo") == "promedio" and n.get("nota")]
        pruebas_mes = [n for n in notas_r if n.get("tipo") == "prueba" and n.get("nota") and n.get("fecha", "") >= inicio_mes]

        pos  = [a for a in anot_r if a.get("tipo") == "positiva"]
        neg  = [a for a in anot_r if a.get("tipo") == "negativa"]

        ctx = f"\n=== {nombre} ({curso}) ===\n"
        if promedios:
            ctx += "\nPROMEDIOS POR ASIGNATURA:\n"
            for asig, nota in sorted(promedios, key=lambda x: x[1]):
                estado = "⚠" if nota < 5.0 else ("↗" if nota >= 6.0 else "→")
                ctx += f"  {estado} {asig}: {nota}\n"
        if pruebas_mes:
            ctx += f"\nEVALUACIONES RENDIDAS EN {nombre_mes.upper()}: {len(pruebas_mes)}\n"
            for p in pruebas_mes:
                ctx += f"  · {p.get('descripcion','')} [{p.get('asignatura','')}]: {p['nota']}\n"
        ctx += f"\nTAREAS CLASSROOM: {len(entregadas)} entregadas · {len(atrasadas)} atrasadas · {len(pendientes)} pendientes\n"
        ctx += f"\nCONDUCTA {nombre_mes}: {len(pos)} positivas · {len(neg)} negativas\n"
        if neg:
            ctx += "  Negativas: " + " | ".join(a.get("titulo", "")[:50] for a in neg[:5]) + "\n"
        if pos:
            ctx += "  Positivas: " + " | ".join(a.get("titulo", "")[:50] for a in pos[:3]) + "\n"

        contexto_partes.append(ctx)

    contexto = "\n".join(contexto_partes)

    prompt = f"""Eres un orientador escolar experto. Genera un informe mensual ejecutivo para los apoderados Manuel y Clau sobre sus hijos en el Colegio Georgian (Saint George), Chile.

DATOS DEL MES:
{contexto}

GENERA el informe en formato apto para Telegram (claro, sin markdown complejo):

📊 INFORME MENSUAL — {nombre_mes.upper()}
Colegio Georgian · Clemente (6°D) y Raimundo (4°A)

[PARA CADA ALUMNO]:

👦 [Nombre] — [evaluación general del mes en 1 línea]

Notas destacadas:
  [máximo 3: mejores y peores]

Conducta:
  [resumen honesto y constructivo]

Tareas:
  [% cumplimiento y alertas si aplica]

RESUMEN FAMILIAR:
  [2-3 oraciones integrando ambos hijos]

PARA LA REUNIÓN DE APODERADOS:
  [3 puntos concretos para llevar / preguntar al colegio]

FOCO PRÓXIMO MES:
  [máximo 3 acciones específicas para Manuel y Clau]

Tono: respetuoso, honesto, orientado a soluciones. No exageres ni suavices los problemas.
"""

    informe = gemini_text(prompt, temperature=0.4)
    log(f"[INFORME] Generado ({len(informe)} chars)")

    if notify:
        # Dividir en partes si es muy largo (Telegram limit: 4096 chars)
        if len(informe) > 3800:
            partes = []
            while informe:
                corte = informe[:3800].rfind("\n")
                if corte < 1000:
                    corte = 3800
                partes.append(informe[:corte])
                informe = informe[corte:].strip()
            for parte in partes:
                send_telegram(parte, parse_mode="HTML")
        else:
            send_telegram(informe, parse_mode="HTML")

    return informe


# ─────────────────────────────────────────────────────────────────────────────
# 5. DETECCIÓN DE PATRONES DE ANOTACIONES
# ─────────────────────────────────────────────────────────────────────────────

DIAS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]

def check_patron_anotaciones(notify: bool = True) -> list[dict]:
    """
    Detecta patrones en anotaciones negativas:
    - Día de la semana con más anotaciones
    - Asignatura con más anotaciones
    - Tendencia (aumentando / disminuyendo en últimas 2 semanas)

    Solo notifica si hay un patrón claro (≥ 3 anotaciones en mismo día o asignatura).
    """
    sb = get_sb()
    hace60 = (date.today() - timedelta(days=60)).isoformat()

    patrones = []

    for alumno in ALUMNOS:
        nombre = alumno["nombre"]
        slug   = alumno["slug"]

        anot_r = sb.table("anotaciones").select(
            "tipo, titulo, asignatura, fecha"
        ).ilike("alumno", f"%{slug}%").eq("tipo", "negativa").gte(
            "fecha", hace60
        ).execute().data or []

        if len(anot_r) < 3:
            continue

        # Contar por día de la semana
        por_dia: dict[str, int] = {}
        por_asig: dict[str, int] = {}
        hace14 = (date.today() - timedelta(days=14)).isoformat()
        hace28 = (date.today() - timedelta(days=28)).isoformat()
        recientes = 0
        anteriores = 0

        for a in anot_r:
            if not a.get("fecha"):
                continue
            try:
                d = datetime.strptime(a["fecha"], "%Y-%m-%d")
                dia = DIAS_ES[d.weekday()]
                por_dia[dia] = por_dia.get(dia, 0) + 1
            except ValueError:
                pass

            asig = (a.get("asignatura") or "Sin asignatura").strip()
            por_asig[asig] = por_asig.get(asig, 0) + 1

            if a["fecha"] >= hace14:
                recientes += 1
            elif a["fecha"] >= hace28:
                anteriores += 1

        hallazgos = []

        # Patrón por día
        dia_top, count_dia = max(por_dia.items(), key=lambda x: x[1]) if por_dia else ("", 0)
        if count_dia >= 3:
            hallazgos.append(f"📅 {count_dia} anotaciones los <b>{dia_top}</b>")

        # Patrón por asignatura
        asig_top, count_asig = max(por_asig.items(), key=lambda x: x[1]) if por_asig else ("", 0)
        if count_asig >= 3 and asig_top != "Sin asignatura":
            hallazgos.append(f"📚 {count_asig} anotaciones en <b>{asig_top}</b>")

        # Tendencia
        if recientes > anteriores + 1:
            hallazgos.append(f"📈 Aumentando: {recientes} en últimas 2 semanas vs {anteriores} en las 2 anteriores")
        elif anteriores > recientes + 1 and recientes > 0:
            hallazgos.append(f"📉 Mejorando: {recientes} en últimas 2 semanas vs {anteriores} en las 2 anteriores")

        if hallazgos:
            patrones.append({"alumno": nombre, "hallazgos": hallazgos, "total": len(anot_r)})
            log(f"[PATRON] {nombre}: {len(hallazgos)} patrón(es) detectado(s)")

    if notify and patrones:
        lineas = ["🔍 <b>PATRONES DE CONDUCTA</b> (últimos 60 días)\n"]
        for p in patrones:
            nombre_corto = p["alumno"].split()[0]
            lineas.append(f"<b>{nombre_corto}</b> — {p['total']} anotaciones negativas:")
            for h in p["hallazgos"]:
                lineas.append(f"  {h}")
            lineas.append("")
        lineas.append("💡 Considera hablar con el profesor de esa asignatura o revisar los días de más estrés")
        send_telegram("\n".join(lineas))
    elif notify:
        log("[PATRON] Sin patrones claros detectados")

    return patrones


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="AVI School — Alertas inteligentes")
    parser.add_argument("--riesgo",  action="store_true", help="Check de riesgo académico")
    parser.add_argument("--semana",  action="store_true", help="Detector de semana pesada")
    parser.add_argument("--plan",    action="store_true", help="Plan semanal de estudio")
    parser.add_argument("--informe", nargs="?", const=True, metavar="YYYY-MM", help="Informe mensual")
    parser.add_argument("--patron",  action="store_true", help="Detección de patrones en anotaciones")
    parser.add_argument("--all",     action="store_true", help="Ejecutar todo")
    parser.add_argument("--no-notify", action="store_true", help="No enviar a Telegram")
    args = parser.parse_args()

    notify = not args.no_notify

    if not GEMINI_KEY:
        print("[ERROR] Falta GEMINI_API_KEY en .env")
        sys.exit(1)

    if args.all or args.riesgo:
        check_riesgo(notify=notify)

    if args.all or args.semana:
        check_semana_pesada(notify=notify)

    if args.all or args.plan:
        generar_plan_semanal(notify=notify)

    if args.all or args.patron:
        check_patron_anotaciones(notify=notify)

    if args.informe is not None:
        mes = args.informe if isinstance(args.informe, str) else None
        generar_informe_mensual(mes=mes, notify=notify)


if __name__ == "__main__":
    main()
