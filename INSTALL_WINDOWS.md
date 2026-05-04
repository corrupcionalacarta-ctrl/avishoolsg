# Setup browser-use en Windows - AVI School

## Pre-requisitos
- Python 3.11 o superior
- API key gratis de Google Gemini (https://aistudio.google.com/apikey)
- Credenciales de SchoolNet
- Credenciales de Google Classroom (cuenta del alumno)

## Pasos

### 1. Verificar Python
Abre PowerShell:
```powershell
python --version
```
Si dice algo menor a 3.11, instala desde https://www.python.org/downloads/ (marca "Add Python to PATH").

### 2. Crear entorno virtual (recomendado)
En la carpeta `AVI School`:
```powershell
cd "$env:USERPROFILE\OneDrive - Tooxs\Documentos\Claude\Projects\AVI School"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```
Si PowerShell bloquea el script:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### 3. Instalar dependencias
```powershell
pip install -r requirements.txt
playwright install chromium
```
(El segundo comando descarga el navegador que controlara el agente, ~150MB)

### 4. Configurar credenciales
```powershell
copy .env.example .env
notepad .env
```
Completa los 4 valores y guarda.

### 5. Primera corrida (con ventana visible)
Asegurate de que `HEADLESS=false` en `.env`.

**Correr solo un source para testear:**
```powershell
python schoolnet_extractor.py --only schoolnet
python schoolnet_extractor.py --only classroom
```

**Correr ambos en una pasada:**
```powershell
python schoolnet_extractor.py
```

Vas a ver Chrome abrirse, el agente loguearse y navegar.
- SchoolNet: ~2-5 min segun secciones
- Classroom: ~3-7 min segun cantidad de clases

**IMPORTANTE Classroom + Google 2FA:**
Si tu cuenta Google tiene 2FA activado, el script va a esperar 60 segundos para que apruebes
el login en tu telefono. Tenlo a mano la primera vez.

### 6. Resultado
Se generan dos archivos en la carpeta:
- `schoolnet_dump_YYYYMMDD_HHMMSS.json` - JSON estructurado con todo lo extraido
- `schoolnet_raw_YYYYMMDD_HHMMSS.txt` - output crudo del agente (debug)
- `schoolnet_run.log` - log paso a paso de las acciones del agente

## Costo
Gratis con Gemini 2.0 Flash mientras estes dentro del tier free de Google AI Studio
(actualmente 1500 requests/dia, mas que suficiente para este uso).

Si en algun momento te quedas corto, puedes:
- Cambiar `GEMINI_MODEL` a `gemini-1.5-flash` en `.env` (limites distintos)
- Pasar a tier pagado de Gemini (sigue siendo barato)
- O migrar a Claude / GPT cambiando el LLM en `schoolnet_extractor.py`

## Siguiente paso
Una vez validado el dump:
1. Revisamos el JSON juntos para ver que secciones son utiles
2. Filtramos a solo lo importante (notas, tareas con fecha, comunicados)
3. Lo schedulamos diario y conectamos a tu Google Calendar / Sheets
4. Sumamos al flujo principal de AVI School junto con Gmail y Classroom

## Troubleshooting

**`playwright install chromium` falla con timeout:**
```powershell
$env:PLAYWRIGHT_DOWNLOAD_HOST="https://playwright.azureedge.net"
playwright install chromium
```

**El agente se cuelga en login:**
Pon `HEADLESS=false` y observa que esta pasando. Posiblemente SchoolNet tiene captcha o 2FA.
Si tiene captcha, hay que pasar a un approach con sesion persistente del Chrome real.

**"No se encontro JSON en el output":**
Aumenta `max_steps=80` en el script a `120`. SchoolNet con muchas secciones necesita mas pasos.
