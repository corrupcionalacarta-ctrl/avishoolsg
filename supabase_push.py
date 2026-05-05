"""
AVI School - Supabase Push
===========================
Persiste el digest clasificado en Supabase para historial y RAG.
Se invoca desde digest.py despues de classify_with_gemini().

Requiere en .env:
    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_SERVICE_KEY=eyJ...
"""

import os
import re
from datetime import datetime

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()


def push_digest(classified: dict, n_items: int, run_mode: str = "manual") -> bool:
    """
    Inserta en digests + items_colegio.
    Devuelve True si OK, False si falla (nunca raise, no rompe el pipeline).
    """
    url = (os.getenv("SUPABASE_URL") or "").strip()
    key = (os.getenv("SUPABASE_SERVICE_KEY") or "").strip()
    if not url or not key:
        print("[WARN] SUPABASE_URL o SUPABASE_SERVICE_KEY no configurados, skip push")
        return False

    try:
        sb = create_client(url, key)

        # 1. Insert digest principal
        digest_row = {
            "run_mode": run_mode,
            "resumen_ejecutivo": classified.get("resumen_ejecutivo", ""),
            "n_items_total": n_items,
            "n_urgentes": len(classified.get("urgentes", [])),
            "n_importantes": len(classified.get("importantes", [])),
            "n_informativos": len(classified.get("informativos", [])),
            "n_fechas": len(classified.get("fechas_proximas", [])),
            "json_completo": classified,
        }
        result = sb.table("digests").insert(digest_row).execute()
        digest_id = result.data[0]["id"]

        # 2. Insert items individuales
        items_rows = []
        for categoria in ["urgentes", "importantes", "informativos"]:
            cat_singular = {"urgentes": "urgente", "importantes": "importante", "informativos": "informativo"}[categoria]
            for item in classified.get(categoria, []):
                items_rows.append({
                    "digest_id": digest_id,
                    "categoria": cat_singular,
                    "titulo": item.get("titulo", ""),
                    "detalle": item.get("detalle", ""),
                    "asignatura": _extract_asignatura(item.get("titulo", "")),
                })

        for fp in classified.get("fechas_proximas", []):
            items_rows.append({
                "digest_id": digest_id,
                "categoria": "fecha_proxima",
                "titulo": fp.get("evento", ""),
                "detalle": fp.get("tipo", ""),   # tipo: prueba|entrega|reunion|evento
                "fecha_evento": _parse_fecha(fp.get("fecha", "")),
                "asignatura": fp.get("asignatura", ""),
            })

        if items_rows:
            sb.table("items_colegio").insert(items_rows).execute()

        print(f"[OK] Supabase: digest {digest_id[:8]}... con {len(items_rows)} items guardados")
        return True

    except Exception as e:
        print(f"[ERROR] Supabase push fallo: {e}")
        return False


def push_grades(data: dict) -> bool:
    """
    Persiste notas, anotaciones y agenda de SchoolNet en Supabase.
    Soporta estructura con uno o dos alumnos.
    Evita duplicados: borra las de hoy antes de insertar.
    """
    url = (os.getenv("SUPABASE_URL") or "").strip()
    key = (os.getenv("SUPABASE_SERVICE_KEY") or "").strip()
    if not url or not key:
        print("[WARN] Supabase no configurado, skip push grades")
        return False

    try:
        sb = create_client(url, key)
        hoy = datetime.now().strftime("%Y-%m-%d")

        # Normalizar: soporta formato antiguo (un alumno) y nuevo (lista de alumnos)
        alumnos = data.get("alumnos")
        if not alumnos:
            alumno_nombre = data.get("alumno", "Clemente Aravena")
            alumnos = [{
                "nombre": alumno_nombre,
                "notas": data.get("notas", []),
                "anotaciones": data.get("anotaciones", []),
                "agenda": data.get("agenda", []),
            }]

        for alumno in alumnos:
            nombre = alumno.get("nombre", "")
            print(f"[INFO] Guardando datos de {nombre}...")

            # Borrar registros de hoy para este alumno (evita duplicados)
            sb.table("notas").delete().eq("alumno", nombre).gte("extraido_en", f"{hoy}T00:00:00").execute()
            sb.table("anotaciones").delete().eq("alumno", nombre).gte("extraido_en", f"{hoy}T00:00:00").execute()

            # Notas
            notas = alumno.get("notas", [])
            if notas:
                rows = [{
                    "alumno": nombre,
                    "asignatura": n.get("asignatura", ""),
                    "tipo": n.get("tipo", ""),
                    "nota": _parse_nota(n.get("nota")),
                    "promedio_curso": _parse_nota(n.get("promedio_curso")),
                    "descripcion": n.get("descripcion", ""),
                    "fecha": _parse_fecha(str(n.get("fecha", "") or "")),
                } for n in notas]
                sb.table("notas").insert(rows).execute()
                print(f"[OK] {nombre}: {len(rows)} notas guardadas")

            # Anotaciones
            anotaciones = alumno.get("anotaciones", [])
            if anotaciones:
                rows = [{
                    "alumno": nombre,
                    "fecha": _parse_fecha(str(a.get("fecha", "") or "")),
                    "tipo": a.get("tipo", "observacion"),
                    "titulo": a.get("titulo", ""),
                    "descripcion": a.get("descripcion", ""),
                    "asignatura": a.get("asignatura", ""),
                } for a in anotaciones]
                sb.table("anotaciones").insert(rows).execute()
                print(f"[OK] {nombre}: {len(rows)} anotaciones guardadas")

            # Horario (borrar y reinsertar siempre)
            horario = alumno.get("horario", [])
            sb.table("horario").delete().eq("alumno", nombre).execute()
            if horario:
                rows = []
                for h in horario:
                    hora_str = h.get("hora", "")
                    bloque = None
                    hora_inicio = None
                    hora_fin = None
                    tipo_h = "clase"
                    parts = hora_str.split("|")
                    if len(parts) == 2:
                        bloque_part = parts[0].strip()
                        tiempo_part = parts[1].strip()
                        t_match = re.match(r'(\d{2}:\d{2})-(\d{2}:\d{2})', tiempo_part)
                        if t_match:
                            hora_inicio, hora_fin = t_match.group(1), t_match.group(2)
                        b_match = re.match(r'Bloque\s+(\d+)', bloque_part, re.IGNORECASE)
                        if b_match:
                            bloque = int(b_match.group(1))
                        elif "recreo" in bloque_part.lower():
                            tipo_h = "recreo"
                        elif "almuerzo" in bloque_part.lower():
                            tipo_h = "almuerzo"
                    rows.append({
                        "alumno": nombre,
                        "dia": h.get("dia", ""),
                        "bloque": bloque,
                        "hora_inicio": hora_inicio,
                        "hora_fin": hora_fin,
                        "asignatura": h.get("asignatura", ""),
                        "sala": h.get("sala", ""),
                        "tipo": tipo_h,
                    })
                sb.table("horario").insert(rows).execute()
                print(f"[OK] {nombre}: {len(rows)} bloques de horario guardados")

            # Asistencia (upsert en tabla asistencia si existe)
            asistencia_pct = alumno.get("asistencia_pct")
            if asistencia_pct is not None:
                try:
                    sb.table("asistencia").upsert({
                        "alumno": nombre,
                        "asistencia_pct": asistencia_pct,
                        "inasistencias": alumno.get("inasistencias"),
                        "horas_efectuadas": alumno.get("horas_efectuadas"),
                        "actualizado_en": datetime.now().isoformat(),
                    }, on_conflict="alumno").execute()
                    print(f"[OK] {nombre}: asistencia {asistencia_pct}% guardada")
                except Exception as e:
                    print(f"[WARN] asistencia push: {e} (tabla puede no existir aún)")

            # Agenda → items_colegio (borrar antes para evitar duplicados)
            agenda = alumno.get("agenda", [])
            sb.table("items_colegio").delete().eq("alumno", nombre).eq("categoria", "fecha_proxima").execute()
            if agenda:
                rows = []
                for ag in agenda:
                    fecha = _parse_fecha(str(ag.get("fecha", "") or ""))
                    titulo = (ag.get("descripcion") or ag.get("titulo") or "").strip()
                    if not fecha or not titulo:
                        continue
                    rows.append({
                        "alumno": nombre,
                        "categoria": "fecha_proxima",
                        "titulo": titulo,
                        "detalle": titulo,
                        "fecha_evento": fecha,
                        "asignatura": ag.get("asignatura", ""),
                    })
                if rows:
                    sb.table("items_colegio").insert(rows).execute()
                    print(f"[OK] {nombre}: {len(rows)} items de agenda guardados")

        return True

    except Exception as e:
        print(f"[ERROR] Supabase push grades fallo: {e}")
        return False


def _parse_nota(value) -> float | None:
    """Convierte nota a float, maneja '6,5' y '6.5'."""
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "."))
    except (ValueError, TypeError):
        return None


def _extract_asignatura(titulo: str) -> str:
    """Extrae asignatura de titulos tipo '[06 - Matematica] Control'"""
    m = re.search(r'\[([^\]]+)\]', titulo)
    if m:
        partes = m.group(1).split(" - ", 1)
        return partes[-1].strip() if len(partes) > 1 else m.group(1).strip()
    return ""


def _parse_fecha(fecha_str: str) -> str | None:
    """Intenta parsear fecha a formato YYYY-MM-DD para Postgres."""
    if not fecha_str:
        return None
    if re.match(r'^\d{4}-\d{2}-\d{2}$', fecha_str):
        return fecha_str
    for fmt in ["%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"]:
        try:
            return datetime.strptime(fecha_str, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None  # fecha descriptiva → NULL en DB
