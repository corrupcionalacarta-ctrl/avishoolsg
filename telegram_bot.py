"""
AVI School - Bot Telegram Conversacional
=========================================
Escucha mensajes en Telegram y responde usando Gemini con contexto del colegio.

Uso:
    python telegram_bot.py          # corre el bot (loop de polling)
    python telegram_bot.py --test   # responde una sola pregunta de prueba y sale

Comandos disponibles en Telegram:
    /hoy      → resumen del ultimo digest
    /urgente  → solo items urgentes
    /fechas   → proximas evaluaciones/eventos
    /utiles   → utiles que llevar mañana
    [texto]   → pregunta libre al asistente escolar
"""

import glob
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv
from google import genai
from google.genai import types
from supabase import create_client

# Alertas inteligentes (importación lazy para no fallar si el módulo no está)
try:
    import smart_alerts as _sa
    _SMART_ALERTS_OK = True
except ImportError:
    _SMART_ALERTS_OK = False

load_dotenv()

TELEGRAM_BOT_TOKEN = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
TELEGRAM_CHAT_ID   = (os.getenv("TELEGRAM_CHAT_ID") or "").strip()
GEMINI_API_KEY     = (os.getenv("GEMINI_API_KEY") or "").strip()
GEMINI_MODEL       = (os.getenv("GEMINI_MODEL") or "gemini-2.5-flash").strip()
OUTPUT_DIR         = Path(os.getenv("OUTPUT_DIR") or ".")

TELEGRAM_API = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"

_sb = None
def get_sb():
    global _sb
    if _sb is None:
        url = (os.getenv("SUPABASE_URL") or "").strip()
        key = (os.getenv("SUPABASE_SERVICE_KEY") or "").strip()
        if url and key:
            _sb = create_client(url, key)
    return _sb


# ===== CONTEXTO DEL COLEGIO =====

def load_latest_digest() -> dict | None:
    """Carga el digest JSON mas reciente (fallback local)."""
    files = sorted(glob.glob(str(OUTPUT_DIR / "digest_*.json")))
    if not files:
        return None
    try:
        return json.loads(Path(files[-1]).read_text(encoding="utf-8"))
    except Exception:
        return None


def build_context(alumno_filtro: str | None = None) -> str:
    """
    Arma el contexto escolar para el prompt de Gemini.
    Consulta Supabase (notas, anotaciones, agenda, analisis_alumno)
    y complementa con el digest local como fallback.
    """
    hoy   = datetime.now().strftime("%Y-%m-%d")
    en14  = (datetime.now() + timedelta(days=14)).strftime("%Y-%m-%d")
    hace30 = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

    primer_nombre = alumno_filtro.capitalize() if alumno_filtro else None
    lines = [f"=== CONTEXTO ESCOLAR AVI SCHOOL ==="]
    lines.append(f"Fecha: {datetime.now().strftime('%A %d/%m/%Y %H:%M')}")
    lines.append("Alumnos: Clemente Aravena (11 años, 6°D) y Raimundo Aravena (9 años, 4°A) — Colegio Georgian\n")

    sb = get_sb()

    # --- Supabase: análisis IA ---
    if sb:
        try:
            res = sb.table("analisis_alumno") \
                .select("alumno, resumen, tendencia_academica, tendencia_conducta, nivel_alerta, prediccion, alertas, recomendaciones, generado_en") \
                .order("generado_en", desc=True).limit(4).execute()
            analisis_rows = res.data or []
            if analisis_rows:
                lines.append("━━━ ANÁLISIS IA DEL ALUMNO ━━━")
                visto = set()
                for a in analisis_rows:
                    nombre = (a.get("alumno") or "").split()[0]
                    if nombre in visto:
                        continue
                    if primer_nombre and primer_nombre.lower() not in nombre.lower():
                        continue
                    visto.add(nombre)
                    fecha = a.get("generado_en", "")[:10] if a.get("generado_en") else ""
                    lines.append(f"\n{nombre} (análisis {fecha}):")
                    lines.append(f"  Tendencia académica: {a.get('tendencia_academica','?')} | Conducta: {a.get('tendencia_conducta','?')} | Alerta: {a.get('nivel_alerta','?')}")
                    if a.get("resumen"):
                        lines.append(f"  Resumen: {a['resumen']}")
                    if a.get("prediccion"):
                        lines.append(f"  Predicción: {a['prediccion']}")
                    alertas = a.get("alertas") or []
                    if alertas:
                        alerta_strs = [f"[{al.get('prioridad','?').upper()}] {al.get('titulo','')}" for al in alertas]
                        lines.append(f"  Alertas: {' | '.join(alerta_strs)}")
                lines.append("")
        except Exception as e:
            print(f"[WARN] analisis_alumno: {e}")

    # --- Supabase: digest (resumen ejecutivo) ---
    digest_data = None
    if sb:
        try:
            res = sb.table("digests") \
                .select("resumen_ejecutivo, json_completo, created_at") \
                .order("created_at", desc=True).limit(1).execute()
            digest_data = (res.data or [None])[0]
        except Exception as e:
            print(f"[WARN] digests: {e}")

    # Fallback a archivo local si Supabase no tiene digest
    if not digest_data:
        local = load_latest_digest()
        if local:
            digest_data = {"resumen_ejecutivo": local.get("resumen_ejecutivo"), "json_completo": local}

    if digest_data:
        lines.append("━━━ ÚLTIMO RESUMEN EJECUTIVO ━━━")
        lines.append(digest_data.get("resumen_ejecutivo") or "")
        jc = digest_data.get("json_completo") or {}
        urgentes      = jc.get("urgentes", [])
        importantes   = jc.get("importantes", [])
        utiles        = jc.get("utiles_mañana", [])
        autorizaciones = jc.get("autorizaciones_pendientes", [])
        if urgentes:
            lines.append("\n🔴 URGENTE:")
            for u in urgentes:
                lines.append(f"  - {u.get('titulo','')}: {u.get('detalle','')}")
        if importantes:
            lines.append("\n🟡 IMPORTANTE:")
            for i in importantes:
                lines.append(f"  - {i.get('titulo','')}: {i.get('detalle','')}")
        if utiles:
            lines.append("\n🎒 LLEVAR MAÑANA: " + ", ".join(utiles))
        if autorizaciones:
            lines.append("\n📋 AUTORIZACIONES:")
            for a in autorizaciones:
                lines.append(f"  - {a.get('titulo','')} (hasta: {a.get('fecha_limite','?')})")
        lines.append("")

    # --- Supabase: próximas fechas ---
    if sb:
        try:
            q = sb.table("items_colegio") \
                .select("titulo, asignatura, fecha_evento, alumno") \
                .eq("categoria", "fecha_proxima") \
                .gte("fecha_evento", hoy) \
                .lte("fecha_evento", en14) \
                .order("fecha_evento") \
                .execute()
            fechas = q.data if q.data else []
            if primer_nombre:
                fechas = [f for f in fechas if primer_nombre.lower() in (f.get("alumno") or "").lower()]
            if fechas:
                lines.append("━━━ PRÓXIMAS FECHAS (14 días) ━━━")
                for f in fechas:
                    alum_parts = (f.get("alumno") or "").split()
                    alum = alum_parts[0] if alum_parts else ""
                    asig = f"[{f['asignatura']}]" if f.get("asignatura") else ""
                    lines.append(f"  - {f['fecha_evento']}: {f['titulo']} {asig} ({alum})")
                lines.append("")
        except Exception as e:
            print(f"[WARN] items_colegio: {e}")

    # --- Supabase: notas ---
    if sb:
        try:
            q = sb.table("notas") \
                .select("alumno, asignatura, tipo, nota, promedio_curso, descripcion, extraido_en") \
                .order("extraido_en", desc=True).limit(60).execute()
            notas = q.data or []
            if primer_nombre:
                notas = [n for n in notas if primer_nombre.lower() in (n.get("alumno") or "").lower()]
            if notas:
                lines.append("━━━ NOTAS RECIENTES ━━━")
                for n in notas:
                    nombre = (n.get("alumno") or "Alumno").split()[0]
                    vs = f" (prom. curso: {n['promedio_curso']})" if n.get("promedio_curso") else ""
                    lines.append(f"  - {nombre} | {n.get('asignatura','')}: {n.get('nota','–')}{vs} — {n.get('descripcion') or n.get('tipo','')}")
                lines.append("")
        except Exception as e:
            print(f"[WARN] notas: {e}")

    # --- Supabase: anotaciones ---
    if sb:
        try:
            q = sb.table("anotaciones") \
                .select("alumno, fecha, tipo, titulo, descripcion, asignatura") \
                .gte("fecha", hace30) \
                .order("fecha", desc=True).limit(30).execute()
            anots = q.data or []
            if primer_nombre:
                anots = [a for a in anots if primer_nombre.lower() in (a.get("alumno") or "").lower()]
            if anots:
                lines.append("━━━ ANOTACIONES RECIENTES (30 días) ━━━")
                for a in anots:
                    nombre = (a.get("alumno") or "Alumno").split()[0]
                    tipo   = (a.get("tipo") or "observacion").upper()
                    texto  = a.get("titulo") or a.get("descripcion") or ""
                    lines.append(f"  - {nombre} [{tipo}] {a.get('fecha','')}: {texto}")
                lines.append("")
        except Exception as e:
            print(f"[WARN] anotaciones: {e}")

    # --- Supabase: Classroom tareas ---
    if sb:
        try:
            q = sb.table("classroom") \
                .select("alumno, curso, titulo, tipo, fecha_entrega, estado, calificacion, link") \
                .order("fecha_entrega").limit(40).execute()
            tareas = q.data or []
            if primer_nombre:
                tareas = [t for t in tareas if primer_nombre.lower() in (t.get("alumno") or "").lower()]
            if tareas:
                lines.append("━━━ GOOGLE CLASSROOM — TAREAS ━━━")
                for t in tareas:
                    nombre = (t.get("alumno") or "Alumno").split()[0]
                    fecha  = f" | entrega: {t['fecha_entrega']}" if t.get("fecha_entrega") else ""
                    cal    = f" | nota: {t['calificacion']}" if t.get("calificacion") else ""
                    link   = f" → {t['link']}" if t.get("link") else ""
                    lines.append(f"  - {nombre} [{t.get('curso','')}] {t.get('titulo','')} ({t.get('estado','?')}){fecha}{cal}{link}")
                lines.append("")
        except Exception as e:
            print(f"[WARN] classroom: {e}")

    # --- Supabase: Classroom materiales ---
    if sb:
        try:
            q = sb.table("classroom_materiales") \
                .select("alumno, curso, tarea_titulo, nombre, url, tipo") \
                .limit(100).execute()
            mats = q.data or []
            if primer_nombre:
                mats = [m for m in mats if primer_nombre.lower() in (m.get("alumno") or "").lower()]
            if mats:
                # Agrupar por curso
                by_curso: dict[str, list] = {}
                for m in mats:
                    curso = m.get("curso", "Sin curso")
                    by_curso.setdefault(curso, []).append(m)
                lines.append("━━━ GOOGLE CLASSROOM — MATERIALES DE ESTUDIO ━━━")
                for curso, items in by_curso.items():
                    lines.append(f"  [{curso}]")
                    for m in items:
                        tipo = f"({m['tipo']})" if m.get("tipo") else ""
                        lines.append(f"    - {m.get('nombre','')} {tipo} → {m.get('url','')}")
                lines.append("")
        except Exception as e:
            print(f"[WARN] classroom_materiales: {e}")

    return "\n".join(lines)


SYSTEM_PROMPT = """Eres un asistente escolar para apoderados chilenos. Ayudas a Manuel y Clau con la agenda de sus hijos en el Colegio Georgian (Saint George), Chile:
- Clemente Aravena, 11 años, 6°D
- Raimundo Aravena, 9 años, 4°A

Tu rol:
- Responder preguntas sobre la agenda escolar del hijo
- Recordar pruebas, tareas, utiles y compromisos
- Explicar contenidos escolares si el papa necesita ayudar a estudiar
- Ser conciso y practico (esto se lee en el celular)

CONTEXTO ESCOLAR ACTUAL:
{contexto}

Fecha y hora actual: {ahora}

Responde en español, de forma clara y breve. Si no tienes informacion suficiente en el contexto, dilo claramente.
"""

COMMAND_RESPONSES = {
    "/hoy": "resumen_ejecutivo",
    "/urgente": "urgentes",
    "/fechas": "fechas_proximas",
    "/utiles": "utiles_mañana",
}


# ===== GEMINI =====

def ask_gemini(pregunta: str, historial: list[dict] = None, alumno_filtro: str | None = None) -> str:
    """Llama a Gemini con contexto escolar completo (Supabase + digest) y devuelve la respuesta."""
    if not GEMINI_API_KEY:
        return "Error: falta GEMINI_API_KEY"
    try:
        contexto = build_context(alumno_filtro)
        ahora = datetime.now().strftime("%A %d/%m/%Y %H:%M")
        system = SYSTEM_PROMPT.format(contexto=contexto, ahora=ahora)

        client = genai.Client(api_key=GEMINI_API_KEY)

        # Armar historial de conversacion
        contents = []
        if historial:
            for msg in historial[-6:]:  # ultimos 6 mensajes (3 pares)
                contents.append(types.Content(
                    role=msg["role"],
                    parts=[types.Part(text=msg["text"])]
                ))
        contents.append(types.Content(
            role="user",
            parts=[types.Part(text=pregunta)]
        ))

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system,
                temperature=0.3,
                max_output_tokens=1000,
            ),
        )
        return response.text.strip()
    except Exception as e:
        return f"Error al consultar Gemini: {e}"


def handle_command(cmd: str, digest: dict | None) -> str:
    """Responde a comandos slash directamente desde el digest."""
    if not digest:
        return "No hay digest disponible aun. Espera la proxima corrida del pipeline."

    if cmd == "/hoy":
        resumen = digest.get("resumen_ejecutivo", "Sin resumen disponible.")
        urgentes = digest.get("urgentes", [])
        utiles = digest.get("utiles_mañana", [])
        resp = f"📋 <b>Resumen de hoy</b>\n\n{resumen}"
        if urgentes:
            resp += "\n\n🔴 <b>Urgente:</b>"
            for u in urgentes:
                resp += f"\n• {u['titulo']}"
        if utiles:
            resp += "\n\n🎒 <b>Llevar mañana:</b>"
            for u in utiles:
                resp += f"\n• {u}"
        return resp

    elif cmd == "/urgente":
        items = digest.get("urgentes", [])
        if not items:
            importantes = digest.get("importantes", [])
            if importantes:
                resp = "🟡 <b>No hay urgentes. Importantes esta semana:</b>\n"
                for i in importantes:
                    resp += f"\n• <b>{i['titulo']}</b>\n  {i.get('detalle', '')}"
                return resp
            return "No hay items urgentes ni importantes. Todo tranquilo."
        resp = "🔴 <b>Urgentes:</b>\n"
        for u in items:
            resp += f"\n• <b>{u['titulo']}</b>\n  {u.get('detalle', '')}"
        return resp

    elif cmd == "/fechas":
        items = digest.get("fechas_proximas", [])
        if not items:
            return "No hay fechas proximas registradas. Revisa SchoolNet para fechas actualizadas."
        resp = "📅 <b>Proximas fechas:</b>\n"
        for f in items:
            resp += f"\n• {f.get('fecha', '?')} — {f.get('evento', '')} ({f.get('asignatura', '')})"
        return resp

    elif cmd == "/utiles":
        items = digest.get("utiles_mañana", [])
        if not items:
            return "No se detectaron utiles especiales para mañana."
        resp = "🎒 <b>Llevar mañana:</b>\n"
        for u in items:
            resp += f"\n• {u}"
        colacion = digest.get("colacion_especial", "")
        if colacion:
            resp += f"\n\n🥪 <b>Colacion:</b> {colacion}"
        return resp

    return None


# ===== TELEGRAM API =====

def send_message(chat_id: str, text: str, parse_mode: str = "HTML") -> bool:
    if len(text) > 4000:
        text = text[:3990] + "\n\n...(truncado)"
    try:
        r = requests.post(f"{TELEGRAM_API}/sendMessage", json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode,
            "disable_web_page_preview": True,
        }, timeout=15)
        return r.status_code == 200
    except Exception as e:
        print(f"[ERROR] send_message: {e}")
        return False


def get_updates(offset: int = 0) -> list[dict]:
    try:
        r = requests.get(f"{TELEGRAM_API}/getUpdates", params={
            "offset": offset,
            "timeout": 30,
            "allowed_updates": ["message"],
        }, timeout=35)
        if r.status_code == 200:
            return r.json().get("result", [])
    except Exception:
        pass
    return []


# ===== MAIN LOOP =====

def run_bot():
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[ERROR] Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en .env")
        sys.exit(1)

    print(f"[OK] Bot iniciado. Escuchando mensajes de chat_id={TELEGRAM_CHAT_ID}...")
    print("     Ctrl+C para detener.\n")

    offset = 0
    historial = []  # historial de conversacion en memoria

    while True:
        try:
            updates = get_updates(offset)
            for update in updates:
                offset = update["update_id"] + 1
                msg = update.get("message", {})
                if not msg:
                    continue

                chat_id = str(msg.get("chat", {}).get("id", ""))
                text = (msg.get("text") or "").strip()

                # Solo responder al chat autorizado
                if chat_id != TELEGRAM_CHAT_ID:
                    continue
                if not text:
                    continue

                print(f"[MSG] {text[:80]}")

                # Detectar si mencionan a un alumno específico
                text_lower = text.lower()
                if "clemente" in text_lower:
                    alumno_filtro = "clemente"
                elif "raimundo" in text_lower:
                    alumno_filtro = "raimundo"
                else:
                    alumno_filtro = None

                # Comandos slash directos
                digest = load_latest_digest()
                cmd = text.split()[0] if text.startswith("/") else None
                if cmd in ["/start", "/ayuda"]:
                    resp = (
                        "👋 <b>AVI School Bot</b>\n\n"
                        "Comandos rápidos:\n"
                        "/hoy — resumen del dia\n"
                        "/urgente — tareas urgentes\n"
                        "/fechas — proximas pruebas y eventos\n"
                        "/utiles — utiles para mañana\n\n"
                        "Alertas inteligentes:\n"
                        "/riesgo — semáforo de riesgo académico\n"
                        "/semana — detectar semana con muchas pruebas\n"
                        "/plan — plan de estudio para esta semana\n"
                        "/informe — informe mensual completo\n\n"
                        "O escribe cualquier pregunta:\n"
                        "• ¿Cómo va Clemente en notas?\n"
                        "• ¿Tiene Raimundo prueba esta semana?\n"
                        "• ¿Qué llevo mañana?"
                    )
                elif cmd == "/riesgo":
                    if _SMART_ALERTS_OK:
                        send_message(chat_id, "🔍 Analizando riesgo académico...")
                        _sa.check_riesgo(notify=True)
                        resp = None  # smart_alerts ya envió el mensaje
                    else:
                        resp = "⚠ Módulo smart_alerts no disponible"
                elif cmd == "/semana":
                    if _SMART_ALERTS_OK:
                        send_message(chat_id, "📅 Revisando carga de la semana...")
                        _sa.check_semana_pesada(notify=True)
                        resp = None
                    else:
                        resp = "⚠ Módulo smart_alerts no disponible"
                elif cmd == "/plan":
                    if _SMART_ALERTS_OK:
                        send_message(chat_id, "📚 Generando plan de estudio con IA...")
                        _sa.generar_plan_semanal(notify=True)
                        resp = None
                    else:
                        resp = "⚠ Módulo smart_alerts no disponible"
                elif cmd == "/informe":
                    if _SMART_ALERTS_OK:
                        # /informe o /informe 2026-04
                        partes = text.split()
                        mes = partes[1] if len(partes) > 1 else None
                        send_message(chat_id, "📊 Generando informe mensual con IA...")
                        _sa.generar_informe_mensual(mes=mes, notify=True)
                        resp = None
                    else:
                        resp = "⚠ Módulo smart_alerts no disponible"
                elif cmd in COMMAND_RESPONSES or cmd in ["/hoy", "/urgente", "/fechas", "/utiles"]:
                    resp = handle_command(cmd, digest)
                    if resp is None:
                        resp = ask_gemini(text, historial, alumno_filtro)
                else:
                    # Pregunta libre → RAG con Gemini + Supabase
                    resp = ask_gemini(text, historial, alumno_filtro)
                    historial.append({"role": "user", "text": text})
                    historial.append({"role": "model", "text": resp})
                    if len(historial) > 20:
                        historial = historial[-20:]

                if resp is not None:
                    send_message(chat_id, resp)
                print(f"[OK] Respondido")

        except KeyboardInterrupt:
            print("\n[INFO] Bot detenido.")
            break
        except Exception as e:
            print(f"[ERROR] {e}")
            time.sleep(5)


if __name__ == "__main__":
    if "--test" in sys.argv:
        import io
        safe_out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        pregunta = " ".join(sys.argv[2:]) or "Como van las notas de Clemente y Raimundo?"
        safe_out.write(f"Test: '{pregunta}'\n")
        safe_out.write("Construyendo contexto desde Supabase...\n")
        ctx = build_context()
        safe_out.write(f"Contexto ({len(ctx)} chars):\n{ctx[:1000]}\n...\n\n")
        safe_out.flush()
        resp = ask_gemini(pregunta)
        safe_out.write(f"Respuesta:\n{resp}\n")
        safe_out.flush()
    else:
        run_bot()
