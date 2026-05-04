"""
AVI School - Notificadores (Telegram + Email SMTP)
===================================================
Modulo para enviar digest a Telegram y/o email.

Uso programatico:
    from notify import send_telegram, send_email, send_all
    send_all("Hola", "<b>Body</b> con HTML")

CLI:
    python notify.py --test                          # test ambos canales
    python notify.py --telegram "mensaje"            # solo Telegram
    python notify.py --email "Asunto" "Body"         # solo Email
    python notify.py --get-chat-id                   # obtener tu chat_id de Telegram
"""

import argparse
import os
import smtplib
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests
from dotenv import load_dotenv

load_dotenv()


def _clean(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


# Telegram
TELEGRAM_BOT_TOKEN = _clean("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = _clean("TELEGRAM_CHAT_ID")

# Email (usa la misma cuenta Gmail con App Password)
GMAIL_USER = _clean("GMAIL_USER")
GMAIL_APP_PASSWORD = _clean("GMAIL_APP_PASSWORD")
EMAIL_TO = _clean("EMAIL_TO", GMAIL_USER)  # default: a uno mismo


# ===== TELEGRAM =====

def send_telegram(text: str, parse_mode: str = "HTML") -> bool:
    """Envia mensaje al chat configurado. Devuelve True si OK."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[WARN] Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en .env")
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    # Telegram limita a 4096 chars por mensaje
    if len(text) > 4000:
        text = text[:3990] + "\n\n... (truncado)"
    try:
        r = requests.post(url, json={
            "chat_id": TELEGRAM_CHAT_ID,
            "text": text,
            "parse_mode": parse_mode,
            "disable_web_page_preview": True,
        }, timeout=15)
        if r.status_code == 200:
            return True
        print(f"[ERROR] Telegram respondio {r.status_code}: {r.text[:200]}")
        return False
    except Exception as e:
        print(f"[ERROR] Telegram fallo: {e}")
        return False


def get_telegram_chat_id():
    """Helper para descubrir tu chat_id. Mandale un mensaje al bot primero."""
    if not TELEGRAM_BOT_TOKEN:
        print("[ERROR] Falta TELEGRAM_BOT_TOKEN en .env")
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
    r = requests.get(url, timeout=10)
    data = r.json()
    if not data.get("ok"):
        print(f"[ERROR] {data}")
        return
    updates = data.get("result", [])
    if not updates:
        print("[INFO] No hay mensajes recientes. Mandale CUALQUIER mensaje a tu bot")
        print("       desde Telegram (busca su username) y vuelve a correr este comando.")
        return
    print(f"[INFO] {len(updates)} mensajes encontrados:\n")
    seen = set()
    for u in updates:
        msg = u.get("message") or u.get("edited_message") or u.get("channel_post") or {}
        chat = msg.get("chat", {})
        cid = chat.get("id")
        if cid in seen:
            continue
        seen.add(cid)
        title = chat.get("title") or chat.get("username") or chat.get("first_name", "?")
        ctype = chat.get("type")
        print(f"  Chat ID: {cid}   Tipo: {ctype:10s}   Nombre: {title}")
    print("\nCopia el Chat ID que corresponda y pegalo en TELEGRAM_CHAT_ID en .env")


# ===== EMAIL SMTP =====

def send_email(subject: str, body_html: str, to: str = None) -> bool:
    """Envia email via Gmail SMTP. body_html puede ser HTML."""
    if not GMAIL_USER or not GMAIL_APP_PASSWORD:
        print("[WARN] Falta GMAIL_USER o GMAIL_APP_PASSWORD en .env")
        return False
    to = to or EMAIL_TO
    if not to:
        print("[WARN] Sin destinatario (EMAIL_TO no configurado)")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = GMAIL_USER
    msg["To"] = to
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as s:
            s.login(GMAIL_USER, GMAIL_APP_PASSWORD)
            s.send_message(msg)
        return True
    except Exception as e:
        print(f"[ERROR] Email fallo: {e}")
        return False


# ===== HELPER COMBO =====

def send_all(subject: str, body_html: str, telegram_text: str = None) -> dict:
    """Envia a Telegram y Email a la vez. Devuelve dict con resultado de cada canal."""
    return {
        "telegram": send_telegram(telegram_text or _html_to_telegram(body_html)),
        "email": send_email(subject, body_html),
    }


def _html_to_telegram(html: str) -> str:
    """Convierte HTML a un subset valido de Telegram (solo b, i, a, code, pre)."""
    import re
    # Mantener solo tags soportados por Telegram
    allowed = ["b", "strong", "i", "em", "u", "s", "code", "pre", "a"]
    # Quitar tags no soportados
    text = re.sub(r"<(?!/?(?:" + "|".join(allowed) + r")\b)[^>]+>", "", html)
    text = text.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    text = re.sub(r"</?p>", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ===== CLI =====

def main():
    parser = argparse.ArgumentParser()
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--test", action="store_true", help="Test ambos canales con mensaje de prueba")
    g.add_argument("--telegram", type=str, metavar="MENSAJE", help="Solo Telegram")
    g.add_argument("--email", nargs=2, metavar=("ASUNTO", "BODY"), help="Solo Email")
    g.add_argument("--get-chat-id", action="store_true", help="Descubre tu chat_id de Telegram")
    args = parser.parse_args()

    if args.get_chat_id:
        get_telegram_chat_id()
        return

    if args.test:
        print("Test Telegram...")
        ok_t = send_telegram("<b>AVI School</b>: test de canal Telegram. Si lees esto, todo OK.")
        print(f"  Telegram: {'OK' if ok_t else 'FAIL'}")
        print("Test Email...")
        ok_e = send_email("[AVI School] Test de canal email", "<h2>Test OK</h2><p>Si lees esto, el canal email funciona.</p>")
        print(f"  Email:    {'OK' if ok_e else 'FAIL'}")
        return

    if args.telegram:
        ok = send_telegram(args.telegram)
        print(f"Telegram: {'OK' if ok else 'FAIL'}")
        sys.exit(0 if ok else 1)

    if args.email:
        subject, body = args.email
        ok = send_email(subject, body)
        print(f"Email: {'OK' if ok else 'FAIL'}")
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
