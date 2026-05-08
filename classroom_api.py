"""
classroom_api.py - Extractor de Google Classroom via API oficial.
==================================================================
Usa OAuth2 con refresh token persistente. Solo necesita autenticación
manual la primera vez; después corre sin intervención.

Requiere:
  - credentials.json (OAuth 2.0 Desktop App) en la raíz del proyecto
  - Primera vez: abre navegador para autorizar acceso a la cuenta de Clemente

Setup (una sola vez):
  1. Ir a https://console.cloud.google.com
  2. Crear proyecto → APIs → Habilitar "Google Classroom API"
  3. Credenciales → Crear credencial → ID de cliente OAuth 2.0 → Aplicación de escritorio
  4. Descargar JSON → guardar como credentials.json en este directorio
  5. Correr: python classroom_api.py --login clemente

Uso:
    python classroom_api.py                  # todos los alumnos
    python classroom_api.py clemente         # solo Clemente
    python classroom_api.py --login          # forzar re-autenticación
"""

import json
import os
import sys
from datetime import datetime, date, timedelta
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "."))

# ─── Scopes mínimos necesarios ────────────────────────────────────────────────
SCOPES = [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
    "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
    "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
]

CREDENTIALS_FILE = OUTPUT_DIR / "credentials.json"
ALUMNOS_CONFIG = []
for i in (1, 2):
    nombre = (os.getenv(f"ALUMNO_{i}_NOMBRE") or "").strip()
    email  = (os.getenv(f"ALUMNO_{i}_CLASSROOM") or "").strip()
    if nombre and email:
        ALUMNOS_CONFIG.append({
            "nombre": nombre,
            "email":  email,
            "slug":   nombre.split()[0].lower(),
            "token_file": OUTPUT_DIR / f".classroom_token_{nombre.split()[0].lower()}.json",
        })


# ─── Autenticación ────────────────────────────────────────────────────────────

def get_credentials(alumno: dict, force: bool = False):
    """Obtiene credenciales OAuth2, renovando el token si es necesario."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from google_auth_oauthlib.flow import InstalledAppFlow

    token_file = alumno["token_file"]
    creds = None

    if not force and token_file.exists():
        creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                print(f"[OK] Token renovado para {alumno['nombre']}")
            except Exception as e:
                print(f"[WARN] No se pudo renovar token: {e}")
                creds = None

        if not creds:
            if not CREDENTIALS_FILE.exists():
                print(f"\n[ERROR] No existe credentials.json")
                print(f"        Sigue las instrucciones en el encabezado de este script.")
                sys.exit(1)

            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            print(f"\n[AUTH] Abriendo navegador para autorizar {alumno['nombre']} ({alumno['email']})...")
            print(f"       Inicia sesión con la cuenta: {alumno['email']}\n")
            creds = flow.run_local_server(port=0, open_browser=True)
            print(f"[OK] Autorización completada para {alumno['nombre']}")

        # Guardar token para próximas veces
        token_file.write_text(creds.to_json())

    return creds


def build_service(alumno: dict, force_login: bool = False):
    from googleapiclient.discovery import build
    creds = get_credentials(alumno, force=force_login)
    return build("classroom", "v1", credentials=creds)


# ─── Extracción ───────────────────────────────────────────────────────────────

def get_courses(service) -> list[dict]:
    """Lista todos los cursos activos del alumno."""
    result = []
    page_token = None
    while True:
        resp = service.courses().list(
            studentId="me",
            courseStates=["ACTIVE"],
            pageSize=50,
            pageToken=page_token,
        ).execute()
        for c in resp.get("courses", []):
            result.append({"id": c["id"], "nombre": c["name"]})
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return result


def get_course_materials(service, course: dict) -> list[dict]:
    """
    Obtiene materiales publicados por el profe (courseWorkMaterials).
    Incluye archivos Drive, links, YouTube, etc.
    """
    items = []
    page_token = None
    while True:
        try:
            resp = service.courses().courseWorkMaterials().list(
                courseId=course["id"],
                pageSize=100,
                pageToken=page_token,
            ).execute()
        except Exception as e:
            print(f"       [WARN] courseWorkMaterials: {e}")
            break

        for m in resp.get("courseWorkMaterial", []):
            materiales = _extract_materials(m)
            items.append({
                "titulo":    m.get("title", ""),
                "tipo":      "material",
                "estado":    "informativo",
                "link":      m.get("alternateLink", ""),
                "fecha_entrega": None,
                "calificacion":  None,
                "materiales_inline": materiales,
            })

        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return items


def get_course_work(service, course: dict) -> list[dict]:
    """
    Obtiene tareas del alumno (courseWork) con su estado de entrega.
    """
    items = []
    page_token = None
    while True:
        try:
            resp = service.courses().courseWork().list(
                courseId=course["id"],
                pageSize=100,
                pageToken=page_token,
            ).execute()
        except Exception as e:
            print(f"       [WARN] courseWork: {e}")
            break

        for cw in resp.get("courseWork", []):
            # Fecha de entrega
            due = cw.get("dueDate")
            fecha_entrega = None
            if due:
                try:
                    fecha_entrega = date(due["year"], due["month"], due["day"]).isoformat()
                except Exception:
                    pass

            # Materiales adjuntos a la tarea
            materiales = _extract_materials(cw)

            items.append({
                "titulo":    cw.get("title", ""),
                "tipo":      "tarea",
                "estado":    "pendiente",
                "link":      cw.get("alternateLink", ""),
                "fecha_entrega": fecha_entrega,
                "calificacion":  None,
                "materiales_inline": materiales,
            })

        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    # Obtener estados de entrega del alumno
    _enrich_submission_states(service, course["id"], items)
    return items


def _enrich_submission_states(service, course_id: str, items: list[dict]):
    """Agrega estado de entrega (submitted/graded) a las tareas."""
    try:
        resp = service.courses().courseWork().studentSubmissions().list(
            courseId=course_id,
            courseWorkId="-",  # all
            userId="me",
            pageSize=100,
        ).execute()
    except Exception:
        return

    # Mapear por courseWorkId
    sub_by_work: dict[str, dict] = {}
    for s in resp.get("studentSubmissions", []):
        cwid = s.get("courseWorkId", "")
        sub_by_work[cwid] = s

    for item in items:
        if item["tipo"] != "tarea":
            continue
        # Extraer courseWorkId del link
        link = item.get("link", "")
        cwid = link.rstrip("/").split("/")[-1] if link else ""
        sub = sub_by_work.get(cwid)
        if not sub:
            continue

        state = sub.get("state", "")
        grade = sub.get("assignedGrade")
        if state == "TURNED_IN":
            item["estado"] = "entregado"
        elif state == "RETURNED" and grade is not None:
            item["estado"] = "calificado"
            item["calificacion"] = str(grade)
        elif state == "RETURNED":
            item["estado"] = "devuelto"


def _extract_materials(obj: dict) -> list[dict]:
    """
    Extrae archivos adjuntos de un courseWork o courseWorkMaterial.
    Retorna lista de {nombre, url, tipo}.
    """
    result = []
    materials = obj.get("materials", [])
    for mat in materials:
        if "driveFile" in mat:
            df = mat["driveFile"]["driveFile"]
            result.append({
                "nombre": df.get("title", "Archivo Drive"),
                "url":    df.get("alternateLink", ""),
                "tipo":   _drive_tipo(df.get("title", "")),
            })
        elif "youtubeVideo" in mat:
            yt = mat["youtubeVideo"]
            result.append({
                "nombre": yt.get("title", "Video YouTube"),
                "url":    yt.get("alternateLink", ""),
                "tipo":   "video",
            })
        elif "link" in mat:
            lk = mat["link"]
            result.append({
                "nombre": lk.get("title") or lk.get("url", "Link"),
                "url":    lk.get("url", ""),
                "tipo":   "sitio",
            })
        elif "form" in mat:
            fm = mat["form"]
            result.append({
                "nombre": fm.get("title", "Formulario"),
                "url":    fm.get("formUrl", ""),
                "tipo":   "formulario",
            })
    return result


def _drive_tipo(filename: str) -> str:
    name = filename.lower()
    if any(x in name for x in [".pptx", ".ppt", "powerpoint", "presentación", "presentacion"]):
        return "presentacion"
    if any(x in name for x in [".docx", ".doc", "word"]):
        return "documento"
    if any(x in name for x in [".xlsx", ".xls", "excel", "spreadsheet"]):
        return "hoja"
    if ".pdf" in name:
        return "pdf"
    if any(x in name for x in [".jpg", ".jpeg", ".png", ".gif", ".webp", "imagen", "image"]):
        return "archivo"
    return "drive"


# ─── Supabase push ────────────────────────────────────────────────────────────

def push_to_supabase(alumno_nombre: str, all_items: list[dict], all_materiales: list[dict]):
    url = (os.getenv("SUPABASE_URL") or "").strip()
    key = (os.getenv("SUPABASE_SERVICE_KEY") or "").strip()
    if not url or not key:
        print("[WARN] Supabase no configurado")
        return

    from supabase import create_client
    sb = create_client(url, key)

    # classroom
    sb.table("classroom").delete().eq("alumno", alumno_nombre).execute()
    if all_items:
        rows = [{
            "alumno":        alumno_nombre,
            "curso":         i.get("curso", ""),
            "titulo":        i.get("titulo", "")[:300],
            "tipo":          i.get("tipo", "tarea"),
            "fecha_entrega": i.get("fecha_entrega"),
            "estado":        i.get("estado", "pendiente"),
            "calificacion":  i.get("calificacion"),
            "link":          i.get("link", "")[:500],
        } for i in all_items]
        sb.table("classroom").insert(rows).execute()
        print(f"[OK] {alumno_nombre}: {len(rows)} items Classroom guardados")

    # classroom_materiales
    sb.table("classroom_materiales").delete().eq("alumno", alumno_nombre).execute()
    if all_materiales:
        rows = [{
            "alumno":       alumno_nombre,
            "curso":        m.get("curso", ""),
            "tarea_titulo": m.get("tarea_titulo", "")[:300],
            "tarea_link":   m.get("tarea_link", "")[:500],
            "nombre":       m.get("nombre", "")[:300],
            "url":          m.get("url", "")[:500],
            "tipo":         m.get("tipo", "archivo"),
        } for m in all_materiales]
        sb.table("classroom_materiales").insert(rows).execute()
        print(f"[OK] {alumno_nombre}: {len(rows)} materiales guardados")

    # fechas de tareas pendientes en items_colegio
    fechas = [i for i in all_items if i.get("fecha_entrega") and i.get("estado") in ("pendiente", "atrasado")]
    if fechas:
        sb.table("items_colegio").delete().eq("alumno", alumno_nombre).eq("categoria", "fecha_proxima").like("detalle", "Classroom:%").execute()
        sb.table("items_colegio").insert([{
            "alumno":       alumno_nombre,
            "categoria":    "fecha_proxima",
            "titulo":       f["titulo"],
            "detalle":      f"Classroom: {f.get('curso', '')}",
            "fecha_evento": f["fecha_entrega"],
            "asignatura":   f.get("curso", ""),
        } for f in fechas]).execute()
        print(f"[OK] {alumno_nombre}: {len(fechas)} fechas Classroom en agenda")


# ─── Pipeline principal ───────────────────────────────────────────────────────

def extract_alumno(alumno: dict, force_login: bool = False):
    print(f"\n{'='*60}")
    print(f"[Classroom API] {alumno['nombre']} ({alumno['email']})")
    print(f"{'='*60}")

    try:
        service = build_service(alumno, force_login=force_login)
    except SystemExit:
        raise
    except Exception as e:
        print(f"[ERROR] No se pudo autenticar: {e}")
        return [], []

    courses = get_courses(service)
    print(f"[OK] {len(courses)} cursos")

    all_items: list[dict] = []
    all_materiales: list[dict] = []

    for course in courses:
        print(f"  → {course['nombre']}")

        mats = get_course_materials(service, course)
        work = get_course_work(service, course)

        all_course_items = mats + work
        for item in all_course_items:
            item["curso"] = course["nombre"]

        # Separar materiales inline para classroom_materiales
        for item in all_course_items:
            for m in item.pop("materiales_inline", []):
                m["curso"]        = course["nombre"]
                m["tarea_titulo"] = item["titulo"]
                m["tarea_link"]   = item.get("link", "")
                all_materiales.append(m)

        all_items.extend(all_course_items)

        n_mat = sum(1 for i in all_course_items if i["tipo"] == "material")
        n_tar = sum(1 for i in all_course_items if i["tipo"] == "tarea")
        n_arc = sum(1 for m in all_materiales if m.get("curso") == course["nombre"])
        print(f"     {n_mat} materiales + {n_tar} tareas | {n_arc} archivos adjuntos")

    n_tareas = sum(1 for i in all_items if i["tipo"] == "tarea")
    n_mats   = sum(1 for i in all_items if i["tipo"] == "material")
    print(f"\n[RESUMEN] {alumno['nombre']}: {n_tareas} tareas + {n_mats} materiales | {len(all_materiales)} archivos")

    return all_items, all_materiales


def main():
    force_login = "--login" in sys.argv

    filtro = None
    for arg in sys.argv[1:]:
        if arg.lower() in ("clemente", "raimundo"):
            filtro = arg.lower()
            break

    alumnos = ALUMNOS_CONFIG
    if filtro:
        alumnos = [a for a in alumnos if a["slug"] == filtro]

    if not alumnos:
        print("[ERROR] No hay alumnos con CLASSROOM email en .env")
        sys.exit(1)

    for alumno in alumnos:
        items, materiales = extract_alumno(alumno, force_login=force_login)
        push_to_supabase(alumno["nombre"], items, materiales)


if __name__ == "__main__":
    main()
