# StudyQ — gestión académica

Aplicación web de gestión universitaria con Express, PostgreSQL y una interfaz HTML/CSS/JavaScript servida por el mismo servidor. Está preparada para desplegarse como servicio gratuito en Render y utilizar una base de datos de Supabase.

## Funcionalidades

- Crear, editar y eliminar materias.
- Programar clases, prácticas y bloques de estudio en un horario semanal.
- Registrar evaluaciones con ponderación, fecha, estado y notas de 1 a 20.
- Validar en el servidor que las ponderaciones de cada materia no excedan el 100%, incluso ante solicitudes concurrentes.
- Calcular nota acumulada y proyección sobre 20. Se muestra una alerta en la materia cuando la nota acumulada o la proyección quedan por debajo de 18.
- Ver recordatorios de la agenda del día y evaluaciones pendientes de los próximos siete días; cada tarea presenta su cuenta regresiva.
- Resumen académico, filtros por estado y materia, y modo oscuro/claro.
- Acceso protegido por clave compartida, con cookie `HttpOnly` y vencimiento de sesión a los siete días.

## Estructura

```text
.
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── src/
│   └── schema.sql
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── render.yaml
├── server.js
└── README.md
```

## Requisitos

- Node.js 18 o posterior.
- Una base PostgreSQL accesible desde el servidor. El nivel gratuito de Supabase puede usarse para desarrollo y despliegues personales.

## Ejecución local

1. Clona o descarga este repositorio y abre una terminal en su carpeta.
2. Instala dependencias:

   ```bash
   npm install
   ```

3. Copia `.env.example` a `.env`, reemplaza `DATABASE_URL` por la cadena de conexión de PostgreSQL de tu proyecto y define `APP_PASSWORD` con una clave privada de al menos 12 caracteres. No subas `.env` al repositorio.
4. Inicia la aplicación:

   ```bash
   npm start
   ```

5. Abre `http://localhost:3000`. El endpoint `/health` comprueba la conexión con la base y se puede usar también en monitorización.

El servidor ejecuta `src/schema.sql` al arrancar. Las tablas se crean de forma idempotente con `IF NOT EXISTS`; también puedes copiar el contenido del archivo y ejecutarlo manualmente en el SQL Editor de Supabase.

## Crear la base de datos en Supabase

1. Regístrate en [Supabase](https://supabase.com/) y crea un proyecto en una región cercana. Guarda la contraseña de la base en un gestor seguro.
2. En el panel del proyecto, abre **Project Settings → Database** y busca **Connection string**.
3. Selecciona **URI**. Para un servidor Node.js persistente como Render, utiliza la conexión directa si Render puede acceder a ella; si necesitas atravesar restricciones de IPv4, selecciona el **Session pooler**. No uses el Transaction pooler para este servidor sin adaptar el manejo de conexiones.
4. Copia la URI y sustituye usuario, contraseña y host. Configúrala localmente en `DATABASE_URL` o, en Render, como variable secreta. No guardes la contraseña en el código ni en Git.
5. Para crear las tablas manualmente, ve a **SQL Editor → New query**, pega `src/schema.sql` y selecciona **Run**. Si dejas que la aplicación inicialice el esquema al arrancar, este paso es opcional.
6. Comprueba el despliegue consultando `https://tu-servicio.onrender.com/health`; una respuesta `{"status":"ok"}` confirma que el servidor pudo consultar PostgreSQL.

El valor correcto de la variable en Node.js es `process.env.DATABASE_URL` (minúsculas en `process`, mayúsculas en el nombre de la variable).

## Desplegar en Render

1. Sube este proyecto a un repositorio GitHub privado o público.
2. En [Render](https://render.com/), selecciona **New → Blueprint** y conecta el repositorio. Render detectará `render.yaml`. También puedes crear un **Web Service** manualmente con:
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
3. En la configuración del servicio, agrega `DATABASE_URL` con la URI de Supabase y `APP_PASSWORD` con una clave privada de al menos 12 caracteres. Marca ambos valores como secretos y no los incluyas en archivos versionados. `NODE_ENV=production` queda configurado por el Blueprint.
4. Crea el servicio. Durante el inicio, la aplicación aplica el esquema SQL y luego comienza a servir el sitio.
5. Abre la URL de Render y verifica `/health`. El servicio gratuito de Render puede suspenderse cuando no recibe tráfico y tardar en volver a activarse; la base de datos debe permanecer disponible para que la aplicación responda correctamente.

## API principal

Todas las rutas de datos requieren iniciar sesión con `APP_PASSWORD`. La sesión se conserva en una cookie `HttpOnly`, `SameSite=Strict` y expira a los siete días. Las rutas de escritura aceptan JSON y validan sus datos en el servidor.

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Iniciar sesión (`password`) |
| `POST` | `/api/auth/logout` | Cerrar sesión |
| `GET` | `/api/subjects` | Materias con horarios y evaluaciones |
| `POST` | `/api/subjects` | Crear materia (`name`, `color`) |
| `PATCH` | `/api/subjects/:id` | Editar materia |
| `DELETE` | `/api/subjects/:id` | Eliminar materia y sus datos relacionados |
| `POST` | `/api/subjects/:id/schedules` | Crear bloque `class`, `practice` o `study` |
| `DELETE` | `/api/schedules/:id` | Eliminar bloque horario |
| `POST` | `/api/subjects/:id/evaluations` | Crear evaluación |
| `PATCH` | `/api/evaluations/:id` | Editar nota, porcentaje, vencimiento o estado |
| `DELETE` | `/api/evaluations/:id` | Eliminar evaluación |
| `GET` | `/health` | Comprobar servidor y conexión PostgreSQL |

Las ponderaciones son mayores que cero y la suma por materia no puede exceder 100%. Las notas aceptadas van de 1 a 20. Para cada materia, la nota acumulada es el promedio ponderado de las evaluaciones calificadas; la proyección supone nota máxima 20 en el porcentaje restante hasta completar el 100%.
