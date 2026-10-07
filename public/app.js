const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const dayShort = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const typeNames = { class: 'Clase', practice: 'Práctica', study: 'Estudio' };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  subjects: [],
  taskStatus: 'all',
  subjectFilter: 'all',
  showAllTasks: false,
  editingSubjectId: null,
  detailSubjectId: null
};

const subjectModal = $('#subject-modal');
const detailModal = $('#detail-modal');
const welcomeModal = $('#welcome-modal');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function daysUntil(value) {
  const due = parseLocalDate(value);
  if (!due) return null;
  const today = parseLocalDate(localIsoDate());
  return Math.round((due - today) / 86400000);
}

function formatDueDate(value) {
  if (!value) return 'Sin fecha';
  const date = parseLocalDate(value);
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(date);
}

function countdownLabel(value) {
  const days = daysUntil(value);
  if (days === null) return 'Sin fecha';
  if (days < 0) return `Venció hace ${Math.abs(days)} ${Math.abs(days) === 1 ? 'día' : 'días'}`;
  if (days === 0) return 'Vence hoy';
  return `Faltan ${days} ${days === 1 ? 'día' : 'días'}`;
}

function getAllEvaluations() {
  return state.subjects.flatMap((subject) => subject.evaluations.map((evaluation) => ({
    ...evaluation,
    subject_name: subject.name,
    subject_color: subject.color
  })));
}

function gradeSummary(subject) {
  const evaluations = subject.evaluations || [];
  const graded = evaluations.filter((evaluation) => evaluation.grade !== null && evaluation.grade !== '');
  const gradedWeight = graded.reduce((sum, evaluation) => sum + Number(evaluation.percentage), 0);
  const earned = graded.reduce((sum, evaluation) => sum + Number(evaluation.grade) * Number(evaluation.percentage) / 100, 0);
  const accumulated = gradedWeight ? earned * 100 / gradedWeight : null;
  const projected = earned + Math.max(0, 100 - gradedWeight) * 20 / 100;
  return {
    accumulated,
    projected: graded.length ? projected : null,
    gradedWeight,
    totalWeight: evaluations.reduce((sum, evaluation) => sum + Number(evaluation.percentage), 0),
    count: graded.length
  };
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  if (!response.ok) {
    let message = 'No se pudo completar la solicitud.';
    try {
      const data = await response.json();
      if (data.error) message = data.error;
    } catch (_) {
      // Conserva el mensaje general si el servidor no responde JSON.
    }
    const error = new Error(message);
    error.authRequired = response.status === 401;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function toast(message, error = false) {
  const node = document.createElement('div');
  node.className = `toast${error ? ' error' : ''}`;
  node.textContent = message;
  $('#toast-region').append(node);
  window.setTimeout(() => node.remove(), 3600);
}

function subjectFilterOptions() {
  const select = $('#subject-filter');
  const previous = state.subjectFilter;
  select.innerHTML = '<option value="all">Todas las materias</option>' + state.subjects
    .map((subject) => `<option value="${subject.id}">${escapeHtml(subject.name)}</option>`).join('');
  select.value = state.subjects.some((subject) => String(subject.id) === previous) ? previous : 'all';
  state.subjectFilter = select.value;
}

function renderStats() {
  const evaluations = getAllEvaluations();
  const pending = evaluations.filter((evaluation) => evaluation.status === 'pending');
  const summaries = state.subjects.map(gradeSummary).filter((summary) => summary.accumulated !== null);
  const average = summaries.length ? summaries.reduce((sum, summary) => sum + summary.accumulated, 0) / summaries.length : null;
  const sessions = state.subjects.reduce((sum, subject) => sum + subject.schedules.length, 0);
  $('#stat-subjects').textContent = state.subjects.length;
  $('#stat-pending').textContent = pending.length;
  $('#stat-average').textContent = average === null ? '—' : average.toFixed(1);
  $('#stat-sessions').textContent = sessions;
  $('#subject-count').textContent = state.subjects.length;
}

function nextEvaluation(subject) {
  return subject.evaluations
    .filter((evaluation) => evaluation.status === 'pending' && evaluation.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
}

function renderSubjects() {
  const grid = $('#subject-grid');
  $('#empty-subjects').classList.toggle('hidden', state.subjects.length > 0);
  grid.innerHTML = state.subjects.map((subject) => {
    const summary = gradeSummary(subject);
    const score = summary.accumulated === null ? '—' : summary.accumulated.toFixed(1);
    const projection = summary.projected === null ? '—' : summary.projected.toFixed(1);
    const fill = summary.accumulated === null ? 0 : Math.min(100, Math.max(0, summary.accumulated / 20 * 100));
    const alert = (summary.accumulated !== null && summary.accumulated < 18)
      || (summary.projected !== null && summary.projected < 18);
    const next = nextEvaluation(subject);
    const scheduleCount = subject.schedules.length;
    return `<article class="subject-card">
      <div class="subject-topline"><span class="subject-color" style="background:${escapeHtml(subject.color)}"></span><div class="subject-heading-text"><h3 title="${escapeHtml(subject.name)}">${escapeHtml(subject.name)}</h3><p>${scheduleCount} ${scheduleCount === 1 ? 'bloque semanal' : 'bloques semanales'} · ${subject.evaluations.length} evaluaciones</p></div>
      <button class="subject-menu" type="button" data-action="edit-subject" data-id="${subject.id}" aria-label="Editar ${escapeHtml(subject.name)}" title="Editar materia">···</button></div>
      <div class="grade-row"><div><div class="grade-label">NOTA ACUMULADA</div><div class="grade-score">${score}<small> / 20</small></div></div><div class="grade-project">Proyección<strong>${projection} / 20</strong></div></div>
      <div class="grade-track"><div class="grade-fill" style="width:${fill}%;background:${escapeHtml(subject.color)}"></div></div>
      <div class="grade-meta"><span>${summary.count} de ${subject.evaluations.length} notas registradas</span><span>${summary.gradedWeight.toFixed(0)}% evaluado</span></div>
      ${alert ? '<div class="grade-alert"><span class="alert-icon">⚠</span> Tu proyección está por debajo de 18. ¡Aún puedes mejorarla!</div>' : `<div class="grade-ok"><span>✦</span> ${summary.projected === null ? 'Añade evaluaciones para ver tu progreso' : '¡Sigue así, vas por buen camino!'}</div>`}
      <div class="subject-card-bottom"><span class="mini-next">${next ? `Siguiente: ${escapeHtml(next.title)} · ${formatDueDate(next.due_date)}` : 'Sin evaluaciones próximas'}</span><button class="details-link" type="button" data-action="details" data-id="${subject.id}">Ver detalles →</button></div>
    </article>`;
  }).join('');
}

function renderSchedule() {
  const start = new Date();
  const mondayOffset = (start.getDay() + 6) % 7;
  const monday = new Date(start.getFullYear(), start.getMonth(), start.getDate() - mondayOffset);
  const days = Array.from({ length: 7 }, (_, index) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index));
  const today = start.getDay();
  const allSchedules = state.subjects.flatMap((subject) => subject.schedules.map((schedule) => ({
    ...schedule,
    subject_name: subject.name
  })));
  $('#weekly-schedule').innerHTML = days.map((date, index) => {
    const day = (index + 1) % 7;
    const events = allSchedules.filter((schedule) => Number(schedule.day_of_week) === day)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    return `<div class="day-column"><div class="day-name${day === today ? ' today' : ''}">${dayShort[day]}<span class="day-date">${date.getDate()}</span></div>
      <div class="day-events">${events.length ? events.map((event) => `<div class="schedule-event ${event.type}" title="${escapeHtml(typeNames[event.type])}: ${escapeHtml(event.subject_name)}"><strong>${escapeHtml(event.subject_name)}</strong><span>${escapeHtml(event.start_time)} · ${escapeHtml(event.end_time)}</span></div>`).join('') : '<div class="schedule-empty">—</div>'}</div></div>`;
  }).join('');
}

function renderTasks() {
  let evaluations = getAllEvaluations().filter((evaluation) => {
    const matchesStatus = state.taskStatus === 'all' || evaluation.status === state.taskStatus;
    const matchesSubject = state.subjectFilter === 'all' || String(evaluation.subject_id) === state.subjectFilter;
    return matchesStatus && matchesSubject;
  });
  evaluations.sort((a, b) => {
    if (!a.due_date) return b.due_date ? 1 : 0;
    if (!b.due_date) return -1;
    return String(a.due_date).localeCompare(String(b.due_date));
  });
  if (!state.showAllTasks && state.taskStatus === 'all') evaluations = evaluations.filter((evaluation) => evaluation.status === 'pending').slice(0, 5);
  $('#task-list').innerHTML = evaluations.length ? evaluations.map((evaluation) => {
    const completed = evaluation.status === 'completed';
    const countdown = countdownLabel(evaluation.due_date);
    const urgent = !completed && daysUntil(evaluation.due_date) !== null && daysUntil(evaluation.due_date) <= 2;
    return `<div class="task-row"><button class="task-check${completed ? ' checked' : ''}" type="button" data-action="toggle-task" data-id="${evaluation.id}" aria-label="${completed ? 'Marcar pendiente' : 'Marcar completada'}">${completed ? '✓' : ''}</button>
      <div class="task-info"><strong title="${escapeHtml(evaluation.title)}">${escapeHtml(evaluation.title)}</strong><small><span style="color:${escapeHtml(evaluation.subject_color)}">●</span> ${escapeHtml(evaluation.subject_name)} · ${Number(evaluation.percentage)}%</small></div>
      <div class="task-date"><strong class="${urgent ? 'urgent' : ''}">${formatDueDate(evaluation.due_date)}</strong><small class="${urgent ? 'urgent' : ''}">${completed ? 'Completada' : countdown}</small></div>
      <div class="task-actions"><button class="task-edit" type="button" data-action="edit-task" data-id="${evaluation.id}" aria-label="Editar evaluación">✎</button><button class="task-delete" type="button" data-action="delete-task" data-id="${evaluation.id}" aria-label="Eliminar evaluación">×</button></div></div>`;
  }).join('') : '<div class="task-empty">No hay evaluaciones en esta vista. ¡Disfruta el respiro!</div>';
  $('#see-all-tasks').textContent = state.showAllTasks ? 'Ver menos ↑' : 'Ver todas →';
}

function renderWelcome() {
  const today = new Date().getDay();
  const schedules = state.subjects.flatMap((subject) => subject.schedules
    .filter((schedule) => Number(schedule.day_of_week) === today)
    .map((schedule) => ({ ...schedule, subject_name: subject.name })))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const upcoming = getAllEvaluations()
    .filter((evaluation) => evaluation.status === 'pending' && evaluation.due_date && daysUntil(evaluation.due_date) >= 0 && daysUntil(evaluation.due_date) <= 7)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const scheduleRows = schedules.map((item) => `<div class="welcome-line"><span>${escapeHtml(typeNames[item.type])} · ${escapeHtml(item.subject_name)}</span><span>${escapeHtml(item.start_time)}–${escapeHtml(item.end_time)}</span></div>`).join('');
  const evalRows = upcoming.slice(0, 5).map((item) => {
    const days = daysUntil(item.due_date);
    return `<div class="welcome-line"><span>${escapeHtml(item.title)} · ${escapeHtml(item.subject_name)}</span><span class="deadline${days > 2 ? ' normal' : ''}">${countdownLabel(item.due_date)}</span></div>`;
  }).join('');
  $('#welcome-content').innerHTML = `<div class="welcome-section"><div class="welcome-section-head">Hoy en tu horario <span>${schedules.length} ${schedules.length === 1 ? 'bloque' : 'bloques'}</span></div><div class="welcome-lines">${scheduleRows || '<div class="welcome-blank">No tienes clases ni bloques programados para hoy.</div>'}</div></div>
    <div class="welcome-section"><div class="welcome-section-head">Próximas entregas <span>Próximos 7 días</span></div><div class="welcome-lines">${evalRows || '<div class="welcome-blank">No hay evaluaciones pendientes para los próximos días.</div>'}</div></div>`;
}

function updateDates() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  $('#today-label').textContent = date;
  $('#full-date').textContent = date.charAt(0).toUpperCase() + date.slice(1);
}

async function refresh({ welcome = false } = {}) {
  try {
    state.subjects = await api('/api/subjects');
    subjectFilterOptions();
    renderStats();
    renderSubjects();
    renderSchedule();
    renderTasks();
    renderWelcome();
    if (welcome) {
      const lastShown = sessionStorage.getItem('studyq-welcome-date');
      if (lastShown !== localIsoDate()) {
        welcomeModal.classList.remove('hidden');
        sessionStorage.setItem('studyq-welcome-date', localIsoDate());
      }
    }
  } catch (error) {
    if (error.authRequired) $('#auth-modal').classList.remove('hidden');
    else toast(error.message, true);
  }
}

function openSubjectForm(subject = null) {
  state.editingSubjectId = subject ? subject.id : null;
  $('#subject-modal-title').textContent = subject ? 'Editar materia' : 'Nueva materia';
  $('#subject-form').elements.name.value = subject?.name || '';
  $('#subject-form').elements.color.value = subject?.color || '#635BFF';
  subjectModal.classList.remove('hidden');
  $('#subject-name').focus();
}

function closeModals() {
  [subjectModal, detailModal, welcomeModal].forEach((modal) => modal.classList.add('hidden'));
}

function openDetails(subjectId) {
  const subject = state.subjects.find((item) => String(item.id) === String(subjectId));
  if (!subject) return;
  state.detailSubjectId = subject.id;
  $('#detail-title').textContent = subject.name;
  renderDetailBody(subject);
  detailModal.classList.remove('hidden');
}

function renderDetailBody(subject) {
  const schedules = subject.schedules.map((item) => `<div class="detail-item"><span class="schedule-event ${item.type}" style="width:6px;min-height:25px;padding:0"></span><div class="detail-item-main"><strong>${escapeHtml(typeNames[item.type])} · ${escapeHtml(dayNames[Number(item.day_of_week)])}</strong><small>${escapeHtml(item.start_time)}–${escapeHtml(item.end_time)}</small></div><button type="button" data-action="delete-schedule" data-id="${item.id}" aria-label="Eliminar bloque">×</button></div>`).join('');
  const evaluations = subject.evaluations.map((item) => `<div class="detail-item"><div class="detail-item-main"><strong>${escapeHtml(item.title)}</strong><small>${Number(item.percentage)}% · ${item.due_date ? formatDueDate(item.due_date) : 'Sin fecha'} · ${item.status === 'completed' ? 'Completada' : `Pendiente · ${countdownLabel(item.due_date)}`}</small></div><span class="detail-grade">${item.grade === null ? '—' : `${Number(item.grade)}/20`}</span><button type="button" data-action="edit-task" data-id="${item.id}" aria-label="Editar evaluación">✎</button><button type="button" data-action="delete-task" data-id="${item.id}" aria-label="Eliminar evaluación">×</button></div>`).join('');
  $('#detail-body').innerHTML = `<section class="detail-section"><div class="detail-section-title"><h3>Clases, prácticas y estudio</h3><button type="button" data-action="add-schedule" data-id="${subject.id}">＋ Añadir bloque</button></div><div class="detail-list">${schedules || '<div class="detail-empty">Aún no hay bloques de horario.</div>'}</div></section>
    <section class="detail-section"><div class="detail-section-title"><h3>Evaluaciones y ponderación</h3><button type="button" data-action="add-task" data-id="${subject.id}">＋ Añadir evaluación</button></div><div class="detail-list">${evaluations || '<div class="detail-empty">Aún no hay evaluaciones. Agrega una para calcular tu proyección.</div>'}</div></section>
    <div class="modal-actions"><button class="button button-light" type="button" data-action="edit-subject" data-id="${subject.id}">Editar materia</button><button class="button button-light" type="button" data-action="delete-subject" data-id="${subject.id}">Eliminar materia</button></div>`;
}

function addScheduleForm(subjectId) {
  const section = $('#detail-body .detail-section:first-child');
  if ($('.inline-form', section)) return;
  const form = document.createElement('form');
  form.className = 'inline-form';
  form.innerHTML = `<div class="form-grid"><div class="wide"><label class="field-label">Tipo de bloque</label><select class="text-input" name="type" required><option value="class">Clase</option><option value="practice">Práctica</option><option value="study">Estudio</option></select></div><div><label class="field-label">Día</label><select class="text-input" name="day_of_week" required>${dayNames.map((day, index) => `<option value="${index}">${day}</option>`).join('')}</select></div><div><label class="field-label">Desde</label><input class="text-input" type="time" name="start_time" required></div><div><label class="field-label">Hasta</label><input class="text-input" type="time" name="end_time" required></div></div><button class="button button-primary" type="submit">Guardar horario</button>`;
  section.append(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.day_of_week = Number(data.day_of_week);
    try {
      await api(`/api/subjects/${subjectId}/schedules`, { method: 'POST', body: JSON.stringify(data) });
      await refresh();
      const updatedSubject = state.subjects.find((item) => String(item.id) === String(subjectId));
      openDetails(updatedSubject.id);
      toast('Horario añadido.');
    } catch (error) { toast(error.message, true); }
  });
}

function addEvaluationForm(subjectId, evaluation = null) {
  const section = $('#detail-body .detail-section:last-of-type');
  if ($('.inline-form', section)) $('.inline-form', section).remove();
  const form = document.createElement('form');
  form.className = 'inline-form';
  const dueDate = evaluation?.due_date ? String(evaluation.due_date).slice(0, 10) : '';
  form.innerHTML = `<div class="form-grid"><div class="wide"><label class="field-label">Nombre de la evaluación</label><input class="text-input" name="title" maxlength="160" required value="${escapeHtml(evaluation?.title || '')}" placeholder="Ej. Parcial 1"></div><div><label class="field-label">Ponderación (%)</label><input class="text-input" name="percentage" type="number" min="0.01" max="100" step="0.01" required value="${evaluation ? Number(evaluation.percentage) : ''}" placeholder="25"></div><div><label class="field-label">Nota (1–20)</label><input class="text-input" name="grade" type="number" min="1" max="20" step="0.01" value="${evaluation?.grade ?? ''}" placeholder="Pendiente"></div><div><label class="field-label">Fecha</label><input class="text-input" name="due_date" type="date" value="${dueDate}"></div><div><label class="field-label">Estado</label><select class="text-input" name="status"><option value="pending"${evaluation?.status !== 'completed' ? ' selected' : ''}>Pendiente</option><option value="completed"${evaluation?.status === 'completed' ? ' selected' : ''}>Completada</option></select></div></div><button class="button button-primary" type="submit">${evaluation ? 'Guardar cambios' : 'Añadir evaluación'}</button>`;
  section.prepend(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.percentage = Number(data.percentage);
    data.grade = data.grade === '' ? null : Number(data.grade);
    data.due_date = data.due_date || null;
    try {
      await api(evaluation ? `/api/evaluations/${evaluation.id}` : `/api/subjects/${subjectId}/evaluations`, {
        method: evaluation ? 'PATCH' : 'POST',
        body: JSON.stringify(data)
      });
      await refresh();
      const updatedSubject = state.subjects.find((item) => String(item.id) === String(subjectId));
      openDetails(updatedSubject.id);
      toast(evaluation ? 'Evaluación actualizada.' : 'Evaluación añadida.');
    } catch (error) { toast(error.message, true); }
  });
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function handleAction(action, id) {
  try {
    if (action === 'details') openDetails(id);
    if (action === 'edit-subject') {
      const subject = state.subjects.find((item) => String(item.id) === String(id));
      if (subject) openSubjectForm(subject);
    }
    if (action === 'add-schedule') addScheduleForm(id);
    if (action === 'add-task') addEvaluationForm(id);
    if (action === 'edit-task') {
      const subject = state.subjects.find((item) => item.evaluations.some((evaluation) => String(evaluation.id) === String(id)));
      const evaluation = subject?.evaluations.find((item) => String(item.id) === String(id));
      if (subject && evaluation) {
        openDetails(subject.id);
        addEvaluationForm(subject.id, evaluation);
      }
    }
    if (action === 'delete-subject') {
      const subject = state.subjects.find((item) => String(item.id) === String(id));
      if (subject && window.confirm(`¿Eliminar "${subject.name}" y todos sus horarios y evaluaciones?`)) {
        await api(`/api/subjects/${id}`, { method: 'DELETE' });
        closeModals();
        await refresh();
        toast('Materia eliminada.');
      }
    }
    if (action === 'delete-schedule') {
      if (window.confirm('¿Eliminar este bloque horario?')) {
        await api(`/api/schedules/${id}`, { method: 'DELETE' });
        await refresh();
        openDetails(state.detailSubjectId);
        toast('Horario eliminado.');
      }
    }
    if (action === 'delete-task') {
      if (window.confirm('¿Eliminar esta evaluación?')) {
        const detailWasOpen = !detailModal.classList.contains('hidden');
        const subject = state.subjects.find((item) => item.evaluations.some((evaluation) => String(evaluation.id) === String(id)));
        await api(`/api/evaluations/${id}`, { method: 'DELETE' });
        await refresh();
        if (subject && detailWasOpen) openDetails(subject.id);
        toast('Evaluación eliminada.');
      }
    }
    if (action === 'toggle-task') {
      const subject = state.subjects.find((item) => item.evaluations.some((evaluation) => String(evaluation.id) === String(id)));
      const evaluation = subject?.evaluations.find((item) => String(item.id) === String(id));
      if (subject && evaluation) {
        await api(`/api/evaluations/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...evaluation, status: evaluation.status === 'completed' ? 'pending' : 'completed' })
        });
        await refresh();
      }
    }
  } catch (error) {
    toast(error.message, true);
  }
}

document.addEventListener('click', (event) => {
  const actionElement = event.target.closest('[data-action]');
  if (actionElement) handleAction(actionElement.dataset.action, actionElement.dataset.id);
  if (event.target.classList.contains('close-modal')) closeModals();
  if (event.target === subjectModal || event.target === detailModal || event.target === welcomeModal) closeModals();
});

$('#subject-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    if (state.editingSubjectId) {
      await api(`/api/subjects/${state.editingSubjectId}`, { method: 'PATCH', body: JSON.stringify(data) });
    } else {
      await api('/api/subjects', { method: 'POST', body: JSON.stringify(data) });
    }
    closeModals();
    await refresh();
    toast(state.editingSubjectId ? 'Materia actualizada.' : 'Materia añadida.');
  } catch (error) { toast(error.message, true); }
});

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = new FormData(event.currentTarget).get('password');
  try {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
    $('#auth-modal').classList.add('hidden');
    event.currentTarget.reset();
    await refresh({ welcome: true });
  } catch (error) {
    toast(error.message, true);
  }
});

$('#add-subject').addEventListener('click', () => openSubjectForm());
$('#add-subject-top').addEventListener('click', () => openSubjectForm());
$('#empty-add-subject').addEventListener('click', () => openSubjectForm());
$('#subject-filter').addEventListener('change', (event) => {
  state.subjectFilter = event.target.value;
  renderTasks();
});
$$('[data-status-filter]').forEach((button) => button.addEventListener('click', () => {
  state.taskStatus = button.dataset.statusFilter;
  $$('[data-status-filter]').forEach((item) => item.classList.toggle('active', item === button));
  renderTasks();
}));
$('#see-all-tasks').addEventListener('click', (event) => {
  event.preventDefault();
  state.showAllTasks = !state.showAllTasks;
  renderTasks();
});
$('#welcome-done').addEventListener('click', closeModals);
$('#open-welcome').addEventListener('click', () => {
  renderWelcome();
  welcomeModal.classList.remove('hidden');
});
$('#logout-button').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
});
$('#theme-toggle').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('studyq-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModals();
});
$$('.nav-link').forEach((link) => link.addEventListener('click', () => {
  $$('.nav-link').forEach((item) => item.classList.toggle('active', item === link));
}));

if (localStorage.getItem('studyq-theme') === 'dark') document.body.classList.add('dark');
updateDates();
refresh({ welcome: true });
