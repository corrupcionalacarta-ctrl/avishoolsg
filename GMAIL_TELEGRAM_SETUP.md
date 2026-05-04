# Setup Gmail + Telegram - AVI School

Tres pasos. Toma 10 minutos total.

---

## 1. Gmail App Password (4 min)

Lo necesitas para IMAP (leer mails) y SMTP (mandar el digest).

1. Ve a https://myaccount.google.com/security
2. Activa **Verificacion en 2 pasos** si no la tienes
3. Despues de eso, ve a https://myaccount.google.com/apppasswords
4. En "Nombre de la app" escribe: `AVI School`
5. Click "Crear"
6. Te da una password de 16 caracteres tipo `abcd efgh ijkl mnop`
7. Copiala TAL CUAL (con espacios o sin, da lo mismo) en `.env`:
   ```
   GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
   ```

**Aviso:** la App Password es independiente de tu password normal de Gmail.
Si la pierdes, simplemente la revocas y creas otra.

---

## 2. Telegram Bot (3 min)

1. Abre Telegram (app o https://web.telegram.org)
2. Busca **@BotFather** y abrelo
3. Manda `/newbot`
4. Te pregunta nombre: pone algo tipo `AVI School Bot`
5. Te pregunta username: tiene que terminar en `bot` y ser unico, ej: `aviSchoolManu_bot`
6. BotFather te responde con un token tipo `1234567890:AAEhBP-EXAMPLE-TOKEN`
7. Copia ese token a `.env`:
   ```
   TELEGRAM_BOT_TOKEN=1234567890:AAEhBP-EXAMPLE-TOKEN
   ```

### Obtener tu chat_id

El bot necesita saber a quien enviarle.

1. **Buscar el bot** que acabas de crear (por su username) y mandale CUALQUIER mensaje, ejemplo: "hola"
2. En PowerShell:
   ```powershell
   python notify.py --get-chat-id
   ```
3. Te muestra una tabla con los chat_id disponibles. Copia el tuyo.
4. Pegalo en `.env`:
   ```
   TELEGRAM_CHAT_ID=123456789
   ```

### Para recibir en family group

Si quieres que tambien le llegue a tu esposa/familia:
1. Crea un grupo de Telegram
2. Agrega el bot al grupo
3. Manda un mensaje en el grupo
4. Corre `python notify.py --get-chat-id` y usa el chat_id del grupo (suele ser negativo, ej `-100123...`)

---

## 3. Test (1 min)

Con `.env` lleno, prueba:

```powershell
python notify.py --test
```

Deberias ver:
- Notificacion en Telegram
- Email en tu bandeja con asunto `[AVI School] Test de canal email`

Si alguno falla, te dice cual y por que.

---

## Comandos utiles

```powershell
# Extraer mails del colegio de las ultimas 12 horas
python gmail_extractor.py --hours 12

# Extraer desde una fecha exacta
python gmail_extractor.py --since 2026-05-01

# Notificar manualmente
python notify.py --telegram "mensaje rapido"
python notify.py --email "Asunto" "<b>Body</b>"
```

---

## Filtros que vienen por default

`GMAIL_FILTER_FROM`: dominios cuyo remitente importa
- `georgian.cl`, `schoolnet`, `colegium`, `aintgeorge.cl`

`GMAIL_FILTER_KEYWORDS`: palabras en el asunto que importan
- `colegio`, `clase`, `tarea`, `prueba`, `reunion`, `apoderado`, `evaluacion`, `academic`, `saintgeorge`

Editalos en `.env` segun lo que veas en tu bandeja real.
