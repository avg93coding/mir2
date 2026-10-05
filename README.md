# MIR Sprint 2027

PWA de estudio para preparar el MIR con tarjetas, repetición espaciada, simulador, mapa de contenidos y plan intensivo hasta el examen del **23 de enero de 2027**.

> **Estado del contenido:** la infraestructura de estudio está funcional. Se importaron los dos mazos de Otorrinolaringología proporcionados por el usuario (96 tarjetas en total, con sus imágenes). El resto del banco incluido es un **starter/demo** de 54 preguntas distribuido por las 27 áreas editoriales. El mapa curricular contiene 308 temas, pero **no significa que los 308 temas tengan todavía un banco clínico completo**.

## Qué incluye

- Dashboard con cuenta regresiva al MIR 2027.
- Tarjetas con repetición espaciada y teclas rápidas.
- Filtro por materia y modo “solo imágenes”.
- Simulador tipo test con puntuación bruta **+3 acierto / −1 error / 0 blanco**.
- Opción de bloque MIR completo de 210 preguntas cuando el banco tenga suficiente contenido.
- Revisión de respuestas y banco de errores.
- 27 áreas editoriales y 308 temas mapeados.
- Plan de 4 meses por fases.
- Búsqueda global.
- Importación de tarjetas/preguntas por JSON.
- Exportación del progreso.
- Persistencia local mediante `localStorage`.
- PWA instalable y caché offline mediante Service Worker.
- Diseño responsive y modo claro/oscuro.
- Sin backend obligatorio, sin variables de entorno y sin base de datos para el MVP.

## Formato MIR usado

La app toma como referencia la convocatoria 2026 para acceso en 2027:

- Fecha del ejercicio: **23 de enero de 2027**.
- 200 preguntas evaluables + 10 preguntas de reserva.
- 4 opciones por pregunta.
- 4 horas y 30 minutos.
- Corrección: +3 por respuesta correcta, −1 por respuesta incorrecta y 0 en blanco.

Fuentes:

- BOE, Orden SND/854/2026: https://www.boe.es/boe/dias/2026/08/10/pdfs/BOE-A-2026-17429.pdf
- Ministerio de Sanidad: https://www.sanidad.gob.es/gabinete/notasPrensa.do?id=6963&metodo=detalle

## Ejecutar localmente

Requisito: Python 3 (solo para servir archivos estáticos).

```bash
cd mir-sprint-2027
python3 -m http.server 4173
```

Abrir:

```text
http://localhost:4173
```

No abras `index.html` directamente con `file://`, porque `fetch()` y el Service Worker necesitan un servidor HTTP.

## Subir a GitHub

```bash
git init
git add .
git commit -m "Initial MIR Sprint 2027"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git push -u origin main
```

### Recomendación sobre los mazos importados

Los mazos y sus imágenes fueron suministrados por el usuario. Si no tienes derechos de redistribución sobre todos los textos e imágenes, usa un **repositorio privado** y un proyecto privado en Vercel. Para publicar el banco públicamente, primero revisa las licencias/derechos del material.

## Desplegar en Vercel

### Opción A — Integración GitHub (recomendada)

1. Sube esta carpeta a GitHub.
2. En Vercel selecciona **Add New → Project**.
3. Importa el repositorio.
4. Framework Preset: **Other**.
5. Build Command: déjalo vacío.
6. Output Directory: `.`
7. Pulsa **Deploy**.

No requiere variables de entorno.

### Opción B — Vercel CLI

```bash
npm i -g vercel
vercel
vercel --prod
```

## Estructura

```text
mir-sprint-2027/
├── index.html
├── app.js
├── styles.css
├── sw.js
├── manifest.webmanifest
├── vercel.json
├── assets/
│   └── icon.svg
├── data/
│   ├── subjects.json
│   ├── otorrino-cards.json
│   └── questions.json
├── media/
│   └── otorrino/
├── examples/
│   └── import-bank.example.json
└── README.md
```

## Formato para importar contenido

La pantalla **Biblioteca → Importar JSON** acepta un objeto con `cards` y/o `questions`.

### Tarjeta

```json
{
  "id": "cardio-001",
  "subject": "Cardiología",
  "topic": "Síndrome coronario agudo",
  "question": "Pregunta o frente de la tarjeta",
  "answer": "Respuesta",
  "explanation": "Explicación breve",
  "cardType": "flashcard",
  "difficulty": 2,
  "tags": ["MIR", "Cardiología"],
  "source": "Nombre de la guía o fuente",
  "sourceUrl": "https://...",
  "updatedAt": "2026-10-04"
}
```

### Pregunta tipo test

```json
{
  "id": "q-cardio-001",
  "subjectId": "cardio",
  "subject": "Cardiología",
  "topic": "Síndrome coronario agudo",
  "question": "Enunciado",
  "options": ["A", "B", "C", "D"],
  "correctIndex": 1,
  "explanation": "Justificación de la respuesta",
  "difficulty": 3,
  "updatedAt": "2026-10-04",
  "source": "Fuente",
  "sourceUrl": "https://..."
}
```

`correctIndex` empieza en cero: `0=A`, `1=B`, `2=C`, `3=D`.

## Cómo convertirlo en un banco MIR realmente completo

La arquitectura separa la aplicación del contenido. La forma segura de escalarla es añadir bancos por especialidad con estos campos mínimos:

1. `subject` / `topic` normalizados contra `data/subjects.json`.
2. Fuente primaria o guía clínica.
3. Fecha de actualización.
4. Revisión clínica/editorial.
5. Marcación de origen: pregunta oficial, elaboración propia, material del usuario, etc.
6. Revisión periódica de cambios de guías y fármacos.

Esto permite crecer a miles de tarjetas y preguntas sin cambiar la interfaz.

## Privacidad

En esta versión el progreso se guarda **solo en el navegador**. No se envían respuestas ni estadísticas a ningún servidor. Borrar los datos del sitio en el navegador borra el progreso; usa **Exportar progreso** para conservar una copia.

## Aviso clínico

La aplicación es una herramienta educativa para preparación de examen. No debe utilizarse como soporte de decisiones clínicas. El contenido importado desde los mazos del usuario no ha sido auditado tarjeta por tarjeta por un comité clínico independiente.
