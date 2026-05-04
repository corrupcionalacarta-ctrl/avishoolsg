"""
AVI School - Gmail Extractor (IMAP)
====================================
Extrae correos del colegio desde Gmail via IMAP usando App Password.
Filtra por dominios y palabras clave, ventana temporal configurable.

Uso:
    python gmail_extractor.py --hours 12         # ultimas 12h
    python gmail_extractor.py --hours 24         # ultimas 24h
    python gmail_extractor.py --since 2026-05-01 # desde fecha exacta

Salida:
    gmail_dump_<timestamp>.json   - mails extraidos estructurados
"""

import argparse
import base64
import email
import imaplib
import json
import os
import re
import sys
from datetime import datetime, timedelta
from email.header import decode_header
from email.utils import parsedate_to_datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _clean(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


GMAIL_USER = _clean("GMAIL_USER")
GMAIL_APP_PASSWORD = _clean("GMAIL_APP_PASSWORD")
GMAIL_FILTER_FROM = _clean("GMAIL_FILTER_FROM", "georgian.cl,schoolnet,colegium,colegio")
GMAIL_FILTER_KEYWORDS = _clean("GMAIL_FILTER_KEYWORDS", "colegio,clase,tarea,prueba,reunion,apoderado,evaluacion,academic")
GMAIL_FILTER_EXCLUDE_FROM = _clean("GMAIL_FILTER_EXCLUDE_FROM", "tm.openai.com,linkedin.com,emol.cl,bancochile.cl")
GMAIL_INBOX = _clean("GMAIL_INBOX", "INBOX")
OUTPUT_DIR = Path(_clean("OUTPUT_DIR", "."))


def decode_str(value):
    """Decodifica headers tipo =?utf-8?B?...?= a string normal."""
    if not value:
        return ""
    parts = decode_header(value)
    out = []
    for text, charset in parts:
        if isinstance(text, bytes):
            try:
                out.append(text.decode(charset or "utf-8", errors="replace"))
            except (LookupError, TypeError):
                out.append(text.decode("utf-8", errors="replace"))
        else:
            out.append(text)
    return "".join(out)


def clean_html(html: str) -> str:
    """Limpia HTML/CSS/JS quedandose solo con texto legible."""
    # Quitar bloques completos: script, style, head, comentarios
    html = re.sub(r"<!--.*?-->", " ", html, flags=re.DOTALL)
    html = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    html = re.sub(r"<style[^>]*>.*?</style>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    html = re.sub(r"<head[^>]*>.*?</head>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    # Convertir <br> y </p> en salto de linea antes de quitar tags
    html = re.sub(r"</?(br|p|div|tr|li|h[1-6])\s*/?>", "\n", html, flags=re.IGNORECASE)
    # Quitar el resto de tags
    text = re.sub(r"<[^>]+>", " ", html)
    # Decodificar entidades HTML basicas
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<")
    text = text.replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'")
    # Compactar espacios
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


GEMINI_API_KEY = _clean("GEMINI_API_KEY")
GEMINI_MODEL = _clean("GEMINI_MODEL", "gemini-2.5-flash")
PDFS_DIR = OUTPUT_DIR / "pdfs"


def summarize_pdf_with_gemini(pdf_bytes: bytes, filename: str) -> str:
    """Usa Gemini para resumir un PDF. Devuelve resumen en texto o '' si falla."""
    if not GEMINI_API_KEY:
        return ""
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[
                types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
                types.Part.from_text(
                    "Eres un asistente escolar. Resume este documento en 3-5 puntos clave "
                    "para un apoderado chileno de un alumno de 6° básico. "
                    "Enfócate en: fechas importantes, acciones requeridas, contenidos académicos. "
                    "Responde en español, de forma concisa."
                ),
            ],
            config=types.GenerateContentConfig(temperature=0.2, max_output_tokens=500),
        )
        return response.text.strip()
    except Exception as e:
        print(f"[WARN] No se pudo resumir PDF '{filename}': {e}")
        return ""


def extract_attachments(msg) -> list[dict]:
    """Extrae adjuntos PDF del mensaje. Guarda en pdfs/ y retorna metadata + resumen."""
    attachments = []
    if not msg.is_multipart():
        return attachments

    PDFS_DIR.mkdir(exist_ok=True)

    for part in msg.walk():
        ctype = part.get_content_type()
        disp = str(part.get("Content-Disposition") or "")
        filename = part.get_filename()
        if filename:
            filename = decode_str(filename)

        is_pdf = (
            ctype == "application/pdf"
            or (filename and filename.lower().endswith(".pdf"))
            or ctype == "application/octet-stream" and filename and filename.lower().endswith(".pdf")
        )

        if not is_pdf:
            continue

        try:
            payload = part.get_payload(decode=True)
            if not payload:
                continue

            # Guardar PDF localmente
            safe_name = re.sub(r"[^\w\-.]", "_", filename or "adjunto.pdf")
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            pdf_path = PDFS_DIR / f"{timestamp}_{safe_name}"
            pdf_path.write_bytes(payload)

            # Resumir con Gemini
            print(f"[INFO] PDF adjunto: {filename} ({len(payload)//1024}KB) → resumiendo...")
            resumen = summarize_pdf_with_gemini(payload, filename or "adjunto.pdf")

            attachments.append({
                "nombre": filename or "adjunto.pdf",
                "path": str(pdf_path),
                "size_kb": len(payload) // 1024,
                "resumen": resumen,
            })
            print(f"[OK] PDF guardado: {pdf_path.name}")
        except Exception as e:
            print(f"[WARN] Error extrayendo adjunto: {e}")

    return attachments


def extract_body(msg) -> str:
    """Extrae el cuerpo del mensaje, prefiriendo text/plain. Limpia HTML si es lo unico disponible."""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "")
            if "attachment" in disp:
                continue
            if ctype == "text/plain":
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or "utf-8"
                        body = payload.decode(charset, errors="replace")
                        break
                except Exception:
                    pass
        if not body:
            # Fallback a HTML si no hay text/plain
            for part in msg.walk():
                if part.get_content_type() == "text/html":
                    try:
                        payload = part.get_payload(decode=True)
                        if payload:
                            charset = part.get_content_charset() or "utf-8"
                            html = payload.decode(charset, errors="replace")
                            body = clean_html(html)
                            break
                    except Exception:
                        pass
    else:
        try:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or "utf-8"
                raw = payload.decode(charset, errors="replace")
                ctype = msg.get_content_type()
                body = clean_html(raw) if ctype == "text/html" else raw
        except Exception:
            body = str(msg.get_payload())
    return body[:5000]  # Cap a 5k chars


def matches_filters(from_addr: str, subject: str, body: str) -> tuple[bool, str]:
    """Devuelve (matches, motivo). Aplica blacklist primero."""
    from_lower = from_addr.lower()
    subject_lower = subject.lower()

    # Blacklist: si el remitente esta acá, descarta sin importar nada
    for dom in [d.strip().lower() for d in GMAIL_FILTER_EXCLUDE_FROM.split(",") if d.strip()]:
        if dom in from_lower:
            return False, ""

    # Whitelist 1: dominios from
    for dom in [d.strip() for d in GMAIL_FILTER_FROM.split(",") if d.strip()]:
        if dom.lower() in from_lower:
            return True, f"from:{dom}"

    # Whitelist 2: keywords en subject
    for kw in [k.strip() for k in GMAIL_FILTER_KEYWORDS.split(",") if k.strip()]:
        if kw.lower() in subject_lower:
            return True, f"subject:{kw}"

    return False, ""


def fetch_mails(since_date: datetime, debug: bool = False) -> tuple[list[dict], list[dict]]:
    """Conecta IMAP, busca mails desde since_date, aplica filtros.
    Devuelve (matched, all_seen). all_seen se llena solo si debug=True.
    """
    print(f"[INFO] Conectando a imap.gmail.com como {GMAIL_USER}")
    imap = imaplib.IMAP4_SSL("imap.gmail.com")
    try:
        imap.login(GMAIL_USER, GMAIL_APP_PASSWORD)
    except imaplib.IMAP4.error as e:
        print(f"[ERROR] Login fallo: {e}")
        print("        Verifica GMAIL_USER y GMAIL_APP_PASSWORD en .env")
        print("        Crea App Password en https://myaccount.google.com/apppasswords")
        sys.exit(1)

    imap.select(GMAIL_INBOX)
    since_str = since_date.strftime("%d-%b-%Y")
    print(f"[INFO] Buscando mails SINCE {since_str}")

    typ, data = imap.search(None, f'(SINCE {since_str})')
    if typ != "OK":
        print(f"[ERROR] IMAP search fallo: {typ}")
        return [], []

    ids = data[0].split()
    print(f"[INFO] {len(ids)} mails en la ventana, aplicando filtros...")

    matched = []
    all_seen = []
    for msg_id in ids:
        # En modo debug solo necesitamos headers
        fetch_what = "(BODY[HEADER.FIELDS (FROM SUBJECT DATE)])" if debug else "(RFC822)"
        typ, msg_data = imap.fetch(msg_id, fetch_what)
        if typ != "OK":
            continue
        raw_email = msg_data[0][1]
        msg = email.message_from_bytes(raw_email)

        from_addr = decode_str(msg.get("From", ""))
        subject = decode_str(msg.get("Subject", ""))
        date_str = msg.get("Date", "")
        try:
            date_iso = parsedate_to_datetime(date_str).isoformat()
        except (TypeError, ValueError):
            date_iso = date_str

        if debug:
            all_seen.append({
                "fecha": date_iso[:16] if date_iso else "?",
                "de": from_addr[:60],
                "asunto": subject[:80],
            })
            # En debug solo necesitamos saber si match por from/subject (no body)
            match, motivo = matches_filters(from_addr, subject, "")
            if match:
                matched.append({
                    "id": msg_id.decode(),
                    "fecha": date_iso,
                    "de": from_addr,
                    "asunto": subject,
                    "matched_by": motivo,
                })
            continue

        body = extract_body(msg)
        match, motivo = matches_filters(from_addr, subject, body)
        if not match:
            continue

        adjuntos = extract_attachments(msg)

        matched.append({
            "id": msg_id.decode(),
            "fecha": date_iso,
            "de": from_addr,
            "asunto": subject,
            "preview": body[:500],
            "body_full": body,
            "matched_by": motivo,
            "adjuntos": adjuntos,
        })

    imap.close()
    imap.logout()
    print(f"[INFO] {len(matched)} mails coinciden con filtros")
    return matched, all_seen


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--hours", type=int, default=12, help="Ventana en horas (default 12)")
    group.add_argument("--since", type=str, help="Fecha exacta YYYY-MM-DD")
    parser.add_argument("--debug", action="store_true",
                        help="Lista TODOS los remitentes/asuntos (no solo los que matchean) para tunear filtros")
    args = parser.parse_args()

    if not GMAIL_USER or not GMAIL_APP_PASSWORD:
        print("[ERROR] Faltan GMAIL_USER o GMAIL_APP_PASSWORD en .env")
        print("        Setup: https://myaccount.google.com/apppasswords")
        sys.exit(1)

    if args.since:
        since_date = datetime.strptime(args.since, "%Y-%m-%d")
    else:
        since_date = datetime.now() - timedelta(hours=args.hours)

    mails, all_seen = fetch_mails(since_date, debug=args.debug)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    if args.debug:
        # Guardar lista completa para revisar y ajustar filtros
        debug_file = OUTPUT_DIR / f"gmail_debug_{timestamp}.json"
        # Agrupar por dominio para facilitar el tuning
        from collections import Counter
        dominios = Counter()
        for m in all_seen:
            de = m["de"]
            # extraer dominio del email
            mat = re.search(r"@([\w\.\-]+)", de)
            if mat:
                dominios[mat.group(1).lower()] += 1
        debug_file.write_text(json.dumps({
            "ventana_desde": since_date.isoformat(),
            "total": len(all_seen),
            "matched": len(mails),
            "dominios_top": dominios.most_common(30),
            "mails": all_seen,
        }, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\n[DEBUG] Lista completa en {debug_file}")
        print(f"[DEBUG] {len(mails)} de {len(all_seen)} matchearon filtros\n")
        print("Top 20 dominios remitentes (revisa cuales son del colegio):")
        for dom, count in dominios.most_common(20):
            mark = "✓" if any(f.strip().lower() in dom for f in GMAIL_FILTER_FROM.split(",") if f.strip()) else " "
            print(f"  [{mark}] {count:3d}x  {dom}")
        return

    output_file = OUTPUT_DIR / f"gmail_dump_{timestamp}.json"
    payload = {
        "extraido_en": datetime.now().isoformat(),
        "ventana_desde": since_date.isoformat(),
        "cuenta": GMAIL_USER,
        "filtros": {
            "from": GMAIL_FILTER_FROM,
            "keywords": GMAIL_FILTER_KEYWORDS,
        },
        "total_match": len(mails),
        "mails": mails,
    }
    output_file.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[OK] Guardado en {output_file}")
    if mails:
        print("\nResumen:")
        for m in mails[:10]:
            print(f"  - [{m['matched_by']:20s}] {m['fecha'][:16]} | {m['asunto'][:60]}")


if __name__ == "__main__":
    main()
