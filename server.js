require('dotenv').config();

const express = require('express');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { promisify } = require('node:util');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT) || 3000;
const databaseUrl = process.env.DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET || process.env.APP_PASSWORD;

if (!databaseUrl) {
  throw new Error('Falta la variable de entorno DATABASE_URL.');
}
if (!sessionSecret || sessionSecret.length < 12) {
  throw new Error('Configura SESSION_SECRET con una clave de al menos 12 caracteres.');
}
const scrypt = promisify(crypto.scrypt);

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : undefined
});
pool.on('error', (error) => {
  console.error('Error inesperado en una conexión PostgreSQL inactiva:', error);
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function sessionSignature(userId, expiresAt) {
  return crypto.createHmac('sha256', sessionSecret).update(`${userId}.${expiresAt}`).digest('base64url');
}

function authenticatedUserId(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('studyq_session='));
  if (!cookie) return null;
  const token = cookie.slice('studyq_session='.length);
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiresAt, signature] = parts;
  if (!validId(userId) || !expiresAt || !signature || !/^\d+$/.test(expiresAt) || Number(expiresAt) <= Date.now()) {
    return null;
  }
  const expected = Buffer.from(sessionSignature(userId, expiresAt));
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received) ? userId : null;
}

const validId = (value) => /^\d+$/.test(String(value)) && Number(value) > 0;

function requireId(value, label = 'identificador') {
  if (!validId(value)) throw new HttpError(400, `${label} no válido.`);
  return value;
}

function requireText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new HttpError(400, `${label} es obligatorio y admite hasta ${maxLength} caracteres.`);
  }
  return value.trim();
}

function requireEmail(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Ingresa un correo electrónico válido.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Ingresa un correo electrónico válido.');
  }
  return email;
}

function requirePassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new HttpError(400, 'La contraseña debe tener entre 8 y 128 caracteres.');
  }
  return value;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !/^[a-f0-9]{128}$/i.test(hash || '')) return false;
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function setSessionCookie(res, userId) {
  const expiresAt = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const token = `${userId}.${expiresAt}.${sessionSignature(userId, expiresAt)}`;
  res.cookie('studyq_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function requireColor(value) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new HttpError(400, 'El color debe ser un valor hexadecimal, por ejemplo #635BFF.');
  }
  return value;
}

function requireDay(value) {
  const day = Number(value);
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    throw new HttpError(400, 'El día debe ser un número entre 0 (domingo) y 6 (sábado).');
  }
  return day;
}

function requireTime(value, label) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new HttpError(400, `${label} debe tener el formato HH:MM.`);
  }
  return value;
}

function requireDate(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, 'La fecha debe tener el formato AAAA-MM-DD.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, 'La fecha indicada no existe.');
  }
  return value;
}

function requirePercentage(value) {
  const percentage = Number(value);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
    throw new HttpError(400, 'La ponderación debe ser mayor que 0 y no superar 100%.');
  }
  return percentage;
}

function requireGrade(value) {
  if (value === null || value === '' || typeof value === 'undefined') return null;
  const grade = Number(value);
  if (!Number.isFinite(grade) || grade < 1 || grade > 20) {
    throw new HttpError(400, 'La nota debe estar entre 1 y 20.');
  }
  return grade;
}

function requireStatus(value) {
  if (value !== 'pending' && value !== 'completed') {
    throw new HttpError(400, 'El estado debe ser pending o completed.');
  }
  return value;
}

async function getSubjectBundle(userId) {
  const [subjectResult, scheduleResult, evaluationResult] = await Promise.all([
    pool.query('SELECT id, name, color FROM subjects WHERE user_id = $1 ORDER BY name', [userId]),
    pool.query(
      `SELECT id, subject_id, type, day_of_week, to_char(start_time, 'HH24:MI') AS start_time,
              to_char(end_time, 'HH24:MI') AS end_time, location
       FROM schedules WHERE user_id = $1 ORDER BY day_of_week, start_time`,
      [userId]
    ),
    pool.query(
      `SELECT id, subject_id, title, percentage, grade, due_date, status
       FROM evaluations WHERE user_id = $1 ORDER BY due_date NULLS LAST, id`,
      [userId]
    )
  ]);

  const subjects = subjectResult.rows.map((subject) => ({
    ...subject,
    schedules: [],
    evaluations: []
  }));
  const byId = new Map(subjects.map((subject) => [String(subject.id), subject]));
  for (const schedule of scheduleResult.rows) {
    byId.get(String(schedule.subject_id))?.schedules.push(schedule);
  }
  for (const evaluation of evaluationResult.rows) {
    byId.get(String(evaluation.subject_id))?.evaluations.push(evaluation);
  }
  return subjects;
}

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));

app.get('/api/auth/session', asyncRoute(async (req, res) => {
  const userId = authenticatedUserId(req);
  if (!userId) return res.json({ authenticated: false });
  const result = await pool.query('SELECT id, email FROM users WHERE id = $1', [userId]);
  if (!result.rowCount) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: result.rows[0] });
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const email = requireEmail(req.body.email);
  const password = requirePassword(req.body.password);
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73194521)');
    const existingUsers = await client.query('SELECT EXISTS (SELECT 1 FROM users) AS present');
    const created = await client.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, passwordHash]
    );
    if (!existingUsers.rows[0].present) {
      const userId = created.rows[0].id;
      await client.query('UPDATE subjects SET user_id = $1 WHERE user_id IS NULL', [userId]);
      await client.query('UPDATE schedules SET user_id = $1 WHERE user_id IS NULL', [userId]);
      await client.query('UPDATE evaluations SET user_id = $1 WHERE user_id IS NULL', [userId]);
    }
    await client.query('COMMIT');
    setSessionCookie(res, created.rows[0].id);
    res.status(201).json({ authenticated: true, user: created.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw new HttpError(409, 'Ya existe una cuenta con ese correo.');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = requireEmail(req.body.email);
  const password = requirePassword(req.body.password);
  const result = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
  if (!result.rowCount || !await verifyPassword(password, result.rows[0].password_hash)) {
    throw new HttpError(401, 'El correo o la contraseña no son correctos.');
  }
  setSessionCookie(res, result.rows[0].id);
  res.json({ authenticated: true, user: { id: result.rows[0].id, email: result.rows[0].email } });
}));

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('studyq_session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/'
  });
  res.status(204).end();
});

app.use('/api', (req, _res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  const userId = authenticatedUserId(req);
  if (!userId) return next(new HttpError(401, 'Inicia sesión para continuar.'));
  req.userId = userId;
  return next();
});

app.get('/api/subjects', asyncRoute(async (req, res) => {
  res.json(await getSubjectBundle(req.userId));
}));

app.post('/api/subjects', asyncRoute(async (req, res) => {
  const name = requireText(req.body.name, 'El nombre', 100);
  const color = req.body.color === undefined ? '#635BFF' : requireColor(req.body.color);
  const result = await pool.query(
    'INSERT INTO subjects (user_id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color',
    [req.userId, name, color]
  );
  res.status(201).json({ ...result.rows[0], schedules: [], evaluations: [] });
}));

app.patch('/api/subjects/:id', asyncRoute(async (req, res) => {
  const id = requireId(req.params.id, 'La materia');
  const name = requireText(req.body.name, 'El nombre', 100);
  const color = requireColor(req.body.color);
  const result = await pool.query(
    'UPDATE subjects SET name = $1, color = $2 WHERE id = $3 AND user_id = $4 RETURNING id, name, color',
    [name, color, id, req.userId]
  );
  if (!result.rowCount) throw new HttpError(404, 'No se encontró la materia.');
  res.json(result.rows[0]);
}));

app.delete('/api/subjects/:id', asyncRoute(async (req, res) => {
  const result = await pool.query('DELETE FROM subjects WHERE id = $1 AND user_id = $2', [
    requireId(req.params.id, 'La materia'), req.userId
  ]);
  if (!result.rowCount) throw new HttpError(404, 'No se encontró la materia.');
  res.status(204).end();
}));

app.post('/api/subjects/:id/schedules', asyncRoute(async (req, res) => {
  const subjectId = requireId(req.params.id, 'La materia');
  const type = req.body.type;
  if (!['class', 'practice', 'study'].includes(type)) {
    throw new HttpError(400, 'El tipo debe ser class, practice o study.');
  }
  const day = requireDay(req.body.day_of_week);
  const start = requireTime(req.body.start_time, 'La hora de inicio');
  const end = requireTime(req.body.end_time, 'La hora de fin');
  const location = req.body.location === undefined ? '' : req.body.location;
  if (typeof location !== 'string' || location.trim().length > 120) {
    throw new HttpError(400, 'El aula o profesor admite hasta 120 caracteres.');
  }
  if (end <= start) throw new HttpError(400, 'La hora de fin debe ser posterior al inicio.');
  const result = await pool.query(
    `INSERT INTO schedules (user_id, subject_id, type, day_of_week, start_time, end_time, location)
     SELECT $6, id, $2, $3, $4, $5, $7 FROM subjects WHERE id = $1 AND user_id = $6
     RETURNING id, subject_id, type, day_of_week,
               to_char(start_time, 'HH24:MI') AS start_time,
               to_char(end_time, 'HH24:MI') AS end_time, location`,
    [subjectId, type, day, start, end, req.userId, location.trim()]
  );
  if (!result.rowCount) throw new HttpError(404, 'No se encontró la materia.');
  res.status(201).json(result.rows[0]);
}));

app.delete('/api/schedules/:id', asyncRoute(async (req, res) => {
  const result = await pool.query('DELETE FROM schedules WHERE id = $1 AND user_id = $2', [
    requireId(req.params.id, 'El horario'), req.userId
  ]);
  if (!result.rowCount) throw new HttpError(404, 'No se encontró el bloque horario.');
  res.status(204).end();
}));

app.post('/api/subjects/:id/evaluations', asyncRoute(async (req, res) => {
  const subjectId = requireId(req.params.id, 'La materia');
  const title = requireText(req.body.title, 'El título', 160);
  const percentage = requirePercentage(req.body.percentage);
  const grade = requireGrade(req.body.grade);
  const dueDate = requireDate(req.body.due_date);
  const status = 'pending';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const subject = await client.query(
      'SELECT id FROM subjects WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [subjectId, req.userId]
    );
    if (!subject.rowCount) throw new HttpError(404, 'No se encontró la materia.');
    const total = await client.query(
      'SELECT COALESCE(SUM(percentage), 0) AS total FROM evaluations WHERE subject_id = $1 AND user_id = $2',
      [subjectId, req.userId]
    );
    if (Number(total.rows[0].total) + percentage > 100.0001) {
      throw new HttpError(400, 'La suma de las ponderaciones de la materia no puede superar 100%.');
    }
    const result = await client.query(
      `INSERT INTO evaluations (user_id, subject_id, title, percentage, grade, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, subject_id, title, percentage, grade, due_date, status`,
      [req.userId, subjectId, title, percentage, grade, dueDate, status]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.patch('/api/evaluations/:id', asyncRoute(async (req, res) => {
  const id = requireId(req.params.id, 'La evaluación');
  const title = requireText(req.body.title, 'El título', 160);
  const percentage = requirePercentage(req.body.percentage);
  const grade = requireGrade(req.body.grade);
  const dueDate = requireDate(req.body.due_date);
  const requestedStatus = requireStatus(req.body.status);
  const status = grade === null ? 'pending' : requestedStatus;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT subject_id FROM evaluations WHERE id = $1 AND user_id = $2',
      [id, req.userId]
    );
    if (!existing.rowCount) throw new HttpError(404, 'No se encontró la evaluación.');
    const subjectId = existing.rows[0].subject_id;
    const subject = await client.query(
      'SELECT id FROM subjects WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [subjectId, req.userId]
    );
    if (!subject.rowCount) throw new HttpError(404, 'No se encontró la materia.');
    const total = await client.query(
      'SELECT COALESCE(SUM(percentage), 0) AS total FROM evaluations WHERE subject_id = $1 AND user_id = $2 AND id <> $3',
      [subjectId, req.userId, id]
    );
    if (Number(total.rows[0].total) + percentage > 100.0001) {
      throw new HttpError(400, 'La suma de las ponderaciones de la materia no puede superar 100%.');
    }
    const result = await client.query(
      `UPDATE evaluations
       SET title = $1, percentage = $2, grade = $3, due_date = $4, status = $5
       WHERE id = $6 AND user_id = $7
       RETURNING id, subject_id, title, percentage, grade, due_date, status`,
      [title, percentage, grade, dueDate, status, id, req.userId]
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.delete('/api/evaluations/:id', asyncRoute(async (req, res) => {
  const result = await pool.query('DELETE FROM evaluations WHERE id = $1 AND user_id = $2', [
    requireId(req.params.id, 'La evaluación'), req.userId
  ]);
  if (!result.rowCount) throw new HttpError(404, 'No se encontró la evaluación.');
  res.status(204).end();
}));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta de API no encontrada.')));

app.use((error, _req, res, _next) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la solicitud no contiene JSON válido.' });
  }
  console.error(error);
  return res.status(500).json({ error: 'Ocurrió un error interno. Inténtalo nuevamente.' });
});

async function start() {
  const schema = await fs.readFile(path.join(__dirname, 'src', 'schema.sql'), 'utf8');
  await pool.query(schema);
  app.listen(port, () => console.log(`StudyQ disponible en el puerto ${port}`));
}

start().catch((error) => {
  console.error('No se pudo iniciar la aplicación o inicializar la base de datos:', error);
  process.exitCode = 1;
});
