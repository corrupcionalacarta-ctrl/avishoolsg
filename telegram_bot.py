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
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

TELEGRAM_BOT_TOKEN = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
TELEGRAM_CHAT_ID = (os.getenv("TELEGRAM_CHAT_ID") or "").strip()
GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()
GEMINI_MODEL = (os.getenv("GEMINI_MODEL") or "gemini-2.5-flash").strip()
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR") or ".")

TELEGRAM_API = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"


# ===== CONTEXTO DEL COLEGIO =====

def load_latest_digest() -> dict | None:
    """Carga el digest JSON mas reciente."""
    files = sorted(glob.glob(str(OUTPUT_DIR / "digest_*.json")))
    if not files:
        return None
    try:
        return json.loads(Path(files[-1]).read_text(encoding="utf-8"))
    except Exception:
        return None


def build_context() -> str:
    """Arma el contexto escolar para el prompt de Gemini."""
    digest = load_latest_digest()
    if not digest:
        return "No hay informacion escolar disponible todavia."

    lines = []
    lines.append(f"=== RESUMEN ESCOLAR (actualizado {datetime.now().strftime('%d/%m %H:%M')}) ===")
    lines.append(f"Resumen: {digest.get('resumen_ejecutivo', '')}")

    urgentes = digest.get("urgentes", [])
    if urgentes:
        lines.append("\n🔴 URGENTE:")
        for u in urgentes:
            lines.append(f"  - {u['titulo']}: {u.get('detalle', '')}")

    importantes = digest.get("importantes", [])
    if importantes:
        lines.append("\n🟡 IMPORTANTE:")
        for i in importantes:
            lines.append(f"  - {i['titulo']}: {i.get('detalle', '')}")

    fechas = digest.get("fechas_proximas", [])
    if fechas:
        lines.append("\n📅 PROXIMAS FECHAS:")
        for f in fechas:
            lines.append(f"  - {f.get('fecha', '')}: {f.get('evento', '')} ({f.get('asignatura', '')})")

    utiles = digest.get("utiles_mañana", [])
    if utiles:
        lines.append("\n🎒 UTILES PARA MAÑANA:")
        for u in utiles:
            lines.append(f"  - {u}")

    autorizaciones = digest.get("autorizaciones_pendientes", [])
    if autorizaciones:
        lines.append("\n📋 AUTORIZACIONES PENDIENTES:")
        for a in autorizaciones:
            lines.append(f"  - {a['titulo']} (hasta: {a.get('fecha_limite', '?')})")

    informativos = digest.get("informativos", [])
    if informativos:
        lines.append(f"\n📌 INFORMATIVOS ({len(informativos)} items):")
        for inf in informativos[:10]:  # max 10 para no saturar el prompt
            lines.append(f"  - {inf['titulo']}: {inf.get('detalle', '')}")

    return "\n".join(lines)


SYSTEM_PROMPT = """Eres un asistente escolar para apoderados chilenos. Ayudas a Manuel y su señora con la agenda de sus hijos en el Colegio Georgian (Saint George), Chile:
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

def ask_gemini(pregunta: str, historial: list[dict] = None) -> str:
    """Llama a Gemini con contexto escolar y devuelve la respuesta."""
    if not GEMINI_API_KEY:
        return "Error: falta GEMINI_API_KEY"
    try:
        contexto = build_context()
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

                # Comandos slash directos
                digest = load_latest_digest()
                if text.startswith("/") and text.split()[0] in COMMAND_RESPONSES or text in ["/hoy", "/urgente", "/fechas", "/utiles", "/start", "/ayuda"]:
                    if text in ["/start", "/ayuda"]:
                        resp = (
                            "👋 <b>AVI School Bot</b>\n\n"
                            "Comandos:\n"
                            "/hoy — resumen del dia\n"
                            "/urgente — tareas urgentes\n"
                            "/fechas — proximas pruebas y eventos\n"
                            "/utiles — utiles para mañana\n\n"
                            "O escribe cualquier pregunta sobre el colegio."
                        )
                    else:
                        resp = handle_command(text.split()[0], digest)
                        if resp is None:
                            resp = ask_gemini(text, historial)
                else:
                    # Pregunta libre → RAG con Gemini
                    resp = ask_gemini(text, historial)
                    # Guardar en historial
                    historial.append({"role": "user", "text": text})
                    historial.append({"role": "model", "text": resp})
                    if len(historial) > 20:
                        historial = historial[-20:]

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
        print("Test: preguntando al bot...")
        resp = ask_gemini("¿Qué tiene AVI mañana en el colegio?")
        print(f"\nRespuesta:\n{resp}")
    else:
        run_bot()
