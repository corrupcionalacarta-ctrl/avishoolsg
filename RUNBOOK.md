# AVI School - Runbook

Sistema automatizado para procesar info academica de tu hijo desde Gmail, Google
Classroom y SchoolNet, clasificarla con Gemini y enviar digest diario por email.

---

## Arquitectura

```
6:30 AM (Task Scheduler)              18:30 PM (Task Scheduler)
  ↓                                     ↓
daily_morning.bat                     daily_evening.bat
  ↓                                     ↓
run_all.py --morning                  run_all.py --evening
  ↓                                     ↓
gmail_extractor (24h)                 gmail_extractor (12h)
  ↓                                     ↓
schoolnet_extractor (Classroom)       digest.py
  ↓                                     ↓
schoolnet_extractor (SchoolNet)       email
  ↓
digest.py
  ↓
email
```

**Sources:**
- **Gmail** (IMAP): comunicados oficiales del colegio + newsletters Schoolnet
- **Google Classroom** (browser-use + Gemini): tareas y anuncios por asignatura
- **SchoolNet** (browser-use + Gemini): notas, asistencia, agenda detallada

**LLM:** Gemini 2.5 Flash (gratis, 1500 req/dia en tier free)

**Notificacion:** email a tu mismo (`EMAIL_TO` o por default `GMAIL_USER`).

---

## Setup inicial (una sola vez)

Ya esta hecho si seguiste los pasos previos. Si arrancas en otro PC:

```powershell
cd "C:\ruta\AVI School"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m playwright install chromium
copy .env.example .env
notepad .env  # completa todos los valores
python notify.py --email "[AVI] Test" "<b>Funciona</b>"
```

Detalles en `INSTALL_WINDOWS.md` y `GMAIL_TELEGRAM_SETUP.md`.

---

## Registrar el schedule (una sola vez)

Abre PowerShell **en la carpeta del proyecto** y ejecuta:

```powershell
.\register_scheduled_tasks.ps1
```

Eso registra dos tareas en Windows Task Scheduler:
- `AVI School Morning` - corre todos los dias a 06:30
- `AVI School Evening` - corre todos los dias a 18:30

**Verifica:**
```powershell
Get-ScheduledTask -TaskName "AVI School*" | Get-ScheduledTaskInfo
```

**Forzar una corrida ya:**
```powershell
Start-ScheduledTask -TaskName "AVI School Morning"
```

**Borrar las tareas:**
```powershell
Unregister-ScheduledTask -TaskName "AVI School Morning" -Confirm:$false
Unregister-ScheduledTask -TaskName "AVI School Evening" -Confirm:$false
```

---

## Comandos manuales utiles

**Probar todo el pipeline ahora:**
```powershell
python run_all.py --morning
```

**Solo testear el digest con la data actual:**
```powershell
python digest.py --dry-run     # solo muestra items, no llama Gemini
python digest.py --no-email    # genera HTML sin enviar
python digest.py               # genera y manda
```

**Refresh manual de un solo source:**
```powershell
python gmail_extractor.py --hours 24
python gmail_extractor.py --hours 168 --debug  # diagnostico de filtros
python schoolnet_extractor.py --list-classes
python schoolnet_extractor.py --all-pending-classroom --max-per-run 5
python schoolnet_extractor.py --status         # ver progreso Classroom
python schoolnet_extractor.py --only schoolnet
```

**Notificacion suelta:**
```powershell
python notify.py --email "Asunto" "<p>Body</p>"
python notify.py --test
```

---

## Que pasa si...

### El PC esta apagado a las 6:30
Task Scheduler tiene `StartWhenAvailable=true`: cuando enciendas el PC corre la
tarea atrasada automaticamente.

### Falla un extractor
`run_all.py` tiene errores aislados por step: si Gmail falla, igual corre
Classroom y SchoolNet, y el digest sale con lo que haya.

### Gemini me corta cuota (1500/dia free tier)
Cambiar `GEMINI_MODEL=gemini-2.5-flash-lite` en `.env`. Cuota mas alta, calidad
levemente menor (suficiente para clasificacion).

### Classroom pide 2FA cada vez
La sesion del navegador esta en `.browser_session/`. Si Google la invalida,
borra la carpeta y la primera corrida pedira 2FA otra vez. Las siguientes no.
```powershell
Remove-Item -Recurse -Force .browser_session
```

### SchoolNet no tiene login persistente
Si SchoolNet vence sesion seguido, la primera corrida del dia puede tardar mas
porque hace login. Si falla repetidamente, revisa que `SCHOOLNET_PASS` siga
vigente.

### Quiero excluir un dominio/keyword del Gmail
Edita `GMAIL_FILTER_EXCLUDE_FROM` en `.env` y agrega el dominio.
Para descubrir dominios ruidosos:
```powershell
python gmail_extractor.py --hours 168 --debug
```

### Quiero cambiar la hora del schedule
Edita `register_scheduled_tasks.ps1`, cambia `-At "06:30"` por la hora deseada,
y vuelve a correr el script (usa `-Force` asi que sobreescribe).

### Quiero ver los logs
- `run_all_<fecha>.log` - log estructurado de cada corrida (timestamps, resultado por step)
- `run_all_stdout_<fecha>.log` - output crudo del pipeline
- `classroom_run.log` - conversation completa del agente Classroom
- `schoolnet_run.log` - idem SchoolNet

---

## Estructura de archivos

```
AVI School/
├── .env                          # credenciales (NO compartir)
├── .env.example                  # template
├── .gitignore
├── requirements.txt
│
├── gmail_extractor.py            # Source: Gmail IMAP
├── schoolnet_extractor.py        # Source: Classroom + SchoolNet (browser-use)
├── digest.py                     # Consolida + clasifica + envia
├── notify.py                     # Telegram + Email
├── run_all.py                    # Orquestador
│
├── daily_morning.bat             # Wrapper para Task Scheduler 6:30am
├── daily_evening.bat             # Wrapper para Task Scheduler 18:30pm
├── register_scheduled_tasks.ps1  # Registra ambas tareas en Windows
│
├── INSTALL_WINDOWS.md            # Setup inicial
├── GMAIL_TELEGRAM_SETUP.md       # Setup Gmail App Password + Telegram (opcional)
├── RUNBOOK.md                    # Este archivo
│
├── classroom_dump.json           # Acumulado de clases procesadas
├── .classroom_state.json         # State: lista clases + procesadas
├── schoolnet_dump.json           # Ultimo dump SchoolNet
├── gmail_dump_<ts>.json          # Dump Gmail por corrida (rotativo)
├── digest_<ts>.html              # HTML enviado
├── digest_<ts>.json              # JSON estructurado del digest
├── run_all_<fecha>.log           # Log de orquestacion
└── .browser_session/             # Sesion persistente Google (login)
```

---

## Roadmap (futuro)

- [ ] Diff vs digest anterior: notificar SOLO lo que cambio
- [ ] Telegram bot ademas de email (cuando quieras escalar)
- [ ] Google Calendar API: crear eventos automaticos para fechas detectadas
- [ ] Supabase: historico queryable + dashboard
- [ ] Notion: vista semanal por asignatura
- [ ] Soporte multi-alumno (si tienes mas hijos)
