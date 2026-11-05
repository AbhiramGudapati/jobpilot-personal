/* JobPilot Personal: zero-dependency, local-first web planner. */
(() => {
  'use strict';
  const DB_KEY = 'jobpilot.personal.v2';
  const OLD_KEY = 'jobpilot.v1';
  const DEVICE_KEY = 'jobpilot.feed.key';
  const SESSION_KEY = 'jobpilot.feed.session';
  const THEMES_KEY = 'jobpilot.theme';
  const INSTALL_KEY = 'jobpilot.install.dismissed';
  const STAGES = ['Applied', 'Screening', 'Interview', 'Final Round', 'Offer', 'Rejected'];
  const EVENT_TYPES = ['Interview', 'Follow-up', 'Deadline', 'Other'];
  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => Array.from(root.querySelectorAll(q));
  const now = () => new Date();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const isValid = d => d instanceof Date && !Number.isNaN(d.getTime());
  const parseDate = value => value ? new Date(value) : new Date(NaN);
  const fmtDate = value => isValid(parseDate(value)) ? parseDate(value).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : 'Date to confirm';
  const fmtDateTime = value => isValid(parseDate(value)) ? parseDate(value).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) : 'Date to confirm';
  const fmtTime = value => isValid(parseDate(value)) ? parseDate(value).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}) : 'No time';
  const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const localInputValue = d => `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const relative = value => {
    const d = parseDate(value); if (!isValid(d)) return 'Unscheduled';
    const hours = (d - now()) / 3600000;
    if (hours < -1) return 'Past';
    if (hours < 0) return 'Now';
    if (hours < 1) return `In ${Math.max(1, Math.round(hours * 60))} min`;
    if (hours < 48) return `In ${Math.max(1, Math.round(hours))} hr`;
    return `In ${Math.ceil(hours / 24)} days`;
  };
  const safeUrl = value => { try { const u = new URL(String(value)); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
  const durationOf = e => Math.max(15, Math.min(480, Number(e.duration) || (e.type === 'Interview' ? 60 : 30)));
  const endMs = e => isValid(parseDate(e.end)) && parseDate(e.end) > parseDate(e.when) ? parseDate(e.end).getTime() : parseDate(e.when).getTime() + durationOf(e) * 60000;
  const conflicting = (event, ignoreId = '') => db.events.filter(e => e.id !== ignoreId && !e.cancelled && !e.completed && isValid(parseDate(e.when)) &&
    parseDate(event.when).getTime() < endMs(e) && parseDate(e.when).getTime() < endMs(event));
  const isoDate = value => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T12:00:00').toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'}) : '';
  function logStage(job, next, source = 'Manual') {
    if (!STAGES.includes(next) || job.stage === next) return;
    job.stageHistory = Array.isArray(job.stageHistory) ? job.stageHistory : [];
    job.stageHistory.push({from:job.stage || 'Applied', to:next, at:now().toISOString(), source});
    job.stageHistory = job.stageHistory.slice(-30);
    job.stage = next;
  }
  function icsDate(value) { return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/,''); }
  const icsEscape = value => String(value || '').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  function exportCalendar(events, name) {
    const entries = events.filter(e => !e.cancelled && isValid(parseDate(e.when)));
    if (!entries.length) return toast('No scheduled events to export.');
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//JobPilot Personal//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
    for (const e of entries) {
      const start = parseDate(e.when);
      const finish = new Date(endMs(e));
      lines.push('BEGIN:VEVENT',`UID:${icsEscape(e.id)}@jobpilot.local`,`DTSTAMP:${icsDate(now())}`,`DTSTART:${icsDate(start)}`,`DTEND:${icsDate(finish)}`,`SUMMARY:${icsEscape(e.title || 'JobPilot event')}`,`DESCRIPTION:${icsEscape([e.company,e.notes].filter(Boolean).join(' | '))}`);
      if (safeUrl(e.meetingLink)) lines.push(`URL:${icsEscape(safeUrl(e.meetingLink))}`);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    downloadBlob(new Blob([lines.join('\r\n') + '\r\n'],{type:'text/calendar;charset=utf-8'}),name);
  }
  function downloadBlob(blob, filename) {
    const href = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = href; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 3000);
  }

  const stageClass = stage => stage === 'Rejected' ? 'red' : stage === 'Offer' ? 'green' : stage === 'Interview' || stage === 'Final Round' ? 'purple' : '';
  const empty = (text, glyph = '◷') => `<div class="empty"><span class="empty-icon">${glyph}</span>${esc(text)}</div>`;
  const defaultDb = () => ({version: 2, jobs: [], events: [], mailbox: [], lastSyncAt: '', lastScanAt: '', alertIds: {}, seenMailIds: [], reminderEnabled: true});
  function loadDb() {
    try {
      const raw = localStorage.getItem(DB_KEY) || localStorage.getItem(OLD_KEY);
      if (!raw) return defaultDb();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.jobs) || !Array.isArray(parsed.events)) return defaultDb();
      return {...defaultDb(), ...parsed, jobs: parsed.jobs, events: parsed.events, mailbox: Array.isArray(parsed.mailbox) ? parsed.mailbox : [], seenMailIds: Array.isArray(parsed.seenMailIds) ? parsed.seenMailIds : [], alertIds: parsed.alertIds && typeof parsed.alertIds === 'object' ? parsed.alertIds : {}};
    } catch { return defaultDb(); }
  }
  let db = loadDb();
  let activeView = 'overview';
  let displayMonth = new Date(now().getFullYear(), now().getMonth(), 1);
  let selectedDate = new Date(now().getFullYear(), now().getMonth(), now().getDate());
  let editorMode = null;
  let editorId = '';
  let editorMailId = '';
  let toastTimeout;
  let syncBusy = false;
  // A trusted personal device remembers the encryption key after the first unlock.
  // Migrate an existing session-only unlock automatically when the upgrade loads.
  const validFeedKey = candidate => /^[a-f0-9]{64}$/i.test(candidate || '');
  function rememberedFeedKey() {
    const persistent = localStorage.getItem(DEVICE_KEY) || '';
    const session = sessionStorage.getItem(SESSION_KEY) || '';
    const candidate = validFeedKey(persistent) ? persistent : validFeedKey(session) ? session : '';
    if (!candidate) return '';
    try {
      localStorage.setItem(DEVICE_KEY, candidate.toLowerCase());
      sessionStorage.removeItem(SESSION_KEY);
    } catch { /* Browser may disallow persistent storage; fall back to the current session. */ }
    return candidate.toLowerCase();
  }
  let key = rememberedFeedKey();
  let editingSyncKey = false;
  let syncError = '';

  function save(render = true) {
    db.version = 2;
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
    catch { toast('Device storage is full. Export a backup from Settings.'); }
    if (render) paint();
    window.dispatchEvent(new Event('jobpilot:changed'));
  }
  function toast(message) {
    const target = $('#toast');
    target.textContent = message;
    target.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => target.classList.remove('visible'), 4000);
  }
  function setView(view) {
    if (!['overview', 'calendar', 'applications', 'inbox', 'settings'].includes(view)) return;
    activeView = view;
    $$('.view').forEach(el => el.classList.toggle('active', el.id === `view-${view}`));
    $$('[data-view]').forEach(el => { el.classList.toggle('active', el.dataset.view === view); if (el.tagName === 'BUTTON' && el.closest('nav')) el.setAttribute('aria-current', el.dataset.view === view ? 'page' : 'false'); });
    $('#crumbCurrent').textContent = ({overview: 'Overview', calendar: 'Calendar', applications: 'Applications', inbox: 'Yahoo Review', settings: 'Settings'})[view];
    window.scrollTo({top: 0, behavior: 'instant'});
    paint();
  }
  function futureEvents() { return db.events.filter(e => !e.cancelled && isValid(parseDate(e.when)) && parseDate(e.when) >= now()).sort((a, b) => parseDate(a.when) - parseDate(b.when)); }
  function jobsActive() { return db.jobs.filter(j => !['Rejected', 'Offer'].includes(j.stage)); }
  function pendingMails() { return db.mailbox.filter(m => m.status === 'pending'); }
  function pendingInterviewCandidates() {
    return pendingMails().filter(m => m.category === 'interview' && !m.cancelled &&
      ((m.when && isValid(parseDate(m.when))) || /^\d{4}-\d{2}-\d{2}$/.test(m.dateOnly || '')) &&
      !db.events.some(e => e.sourceId === m.id || (m.calendarUid && e.calendarUid === m.calendarUid)));
  }
  function interviewLeads(includePast = false) {
    const saved = db.events.filter(e => e.type === 'Interview' && !e.cancelled && isValid(parseDate(e.when)))
      .map(e => ({kind: 'saved', id: e.id, when: e.when, day: dayKey(parseDate(e.when)), title: e.title || 'Interview', company: e.company || '', meetingLink: e.meetingLink || ''}));
    const tentative = pendingInterviewCandidates().map(m => ({kind: 'review', id: m.id, when: m.when || '',
      day: m.when ? dayKey(parseDate(m.when)) : m.dateOnly,
      title: m.title || m.role || m.subject || 'Interview', company: m.company || '', meetingLink: m.meetingLink || ''}));
    const today = dayKey(now());
    return [...saved, ...tentative].filter(x => includePast || (x.when ? parseDate(x.when) >= now() : x.day >= today))
      .sort((a,b) => a.day.localeCompare(b.day) || (a.when || '9999').localeCompare(b.when || '9999') || a.title.localeCompare(b.title));
  }
  const leadDate = e => e.when ? fmtDateTime(e.when) : `${isoDate(e.day)} · time to confirm`;
  function actionEvents() { return db.events.filter(e => !e.cancelled && !e.completed && ['Follow-up', 'Deadline'].includes(e.type)).sort((a, b) => parseDate(a.when) - parseDate(b.when)); }

  function paint() {
    $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'});
    $('#metricActive').textContent = jobsActive().length;
    $('#metricInterviews').textContent = interviewLeads().length;
    $('#metricInterviewHint').textContent = `${interviewLeads().filter(x=>x.kind==='saved').length} saved · ${interviewLeads().filter(x=>x.kind==='review').length} to review`;
    $('#metricFollowups').textContent = actionEvents().length;
    $('#metricReview').textContent = pendingMails().length;
    $('#sidebarReviewCount').textContent = pendingMails().length;
    $('#sidebarReviewCount').hidden = !pendingMails().length;
    renderOverview(); renderCalendar(); renderJobs(); renderInbox(); renderSettings();
    if (navigator.setAppBadge) navigator.setAppBadge(pendingMails().length + actionEvents().filter(x => parseDate(x.when) < now()).length).catch(() => {});
    const alerts = $('#homeInstallTip');
    if (alerts) alerts.hidden = localStorage.getItem(INSTALL_KEY) === 'yes' || !( /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator.standalone || matchMedia('(display-mode:standalone)').matches));
    const connection = $('#networkStatus');
    if (connection) { connection.textContent = navigator.onLine ? 'Online' : 'Offline mode'; connection.dataset.offline = String(!navigator.onLine); }

  }
  function renderOverview() {
    const upcoming = interviewLeads().slice(0, 12);
    $('#greetingText').textContent = 'Your interviews, applications and next steps. All in one place.';
    $('#nextInterview').innerHTML = upcoming.map(e => `<div class="interview-list-item ${e.kind === 'review' ? 'tentative-item' : ''}">
      <div class="interview-datebox"><strong>${esc(e.when ? fmtTime(e.when) : '—')}</strong><span>${esc(isoDate(e.day))}</span></div>
      <div class="interview-item-body"><div class="interview-heading">${esc(e.company || e.title)}</div><div class="interview-subtitle">${esc(e.company ? e.title : 'Interview')}</div>
        <span class="interview-state ${e.kind === 'review' ? 'pending' : ''}">${e.kind === 'review' ? 'Needs confirmation' : 'On calendar'}</span>
      </div><button type="button" class="button button-quiet small" ${e.kind==='review' ? `data-find-mail="${esc(e.id)}"` : `data-open-day="${esc(e.day)}"`}>${e.kind === 'review' ? 'Review' : 'View'}</button>
    </div>`).join('') || empty('No upcoming interviews found yet. Check Yahoo Inbox or add one manually.', '▦');
    const nonInterviews = futureEvents().filter(e=>e.type !== 'Interview');
    $('#overviewSchedule').innerHTML = nonInterviews.slice(0, 6).map(e => `<div class="item-row"><div class="item-icon">${e.type === 'Deadline' ? '!' : '◷'}</div><div class="item-main"><div class="item-title">${esc(e.title)}</div><div class="item-meta">${esc(e.company || e.type)} · ${esc(fmtDateTime(e.when))}</div></div><button type="button" class="button button-quiet small" data-open-day="${esc(dayKey(parseDate(e.when)))}">View</button></div>`).join('') || empty('No other upcoming tasks.');
    const tasks = [];
    const confirmed = futureEvents().filter(e=>e.type==='Interview');
    const clashes = confirmed.filter(e => conflicting(e,e.id).length);
    if(clashes.length) tasks.push(`<div class="item-row"><div class="item-icon">!</div><div class="item-main"><div class="item-title">${clashes.length} overlapping events</div><div class="item-meta">Review times before your interviews</div></div><button type="button" class="button button-quiet small" data-view="calendar">Calendar</button></div>`);
    const needsReview = interviewLeads().filter(x=>x.kind==='review').length;
    if(needsReview) tasks.push(`<div class="item-row"><div class="item-icon">✉</div><div class="item-main"><div class="item-title">${needsReview} interview${needsReview===1?'':'s'} to confirm</div><div class="item-meta">Detected in Yahoo; check details and add to calendar</div></div><button type="button" class="button button-quiet small" data-view="calendar">Review</button></div>`);
    for (const e of actionEvents().slice(0,3)) tasks.push(`<div class="item-row"><div class="item-icon">◷</div><div class="item-main"><div class="item-title">${esc(e.title)}</div><div class="item-meta">${esc(fmtDateTime(e.when))}</div></div><button type="button" class="button button-quiet small" data-complete="${esc(e.id)}">Done</button></div>`);
    const otherMail = pendingMails().filter(m=>m.category!=='interview').length;
    if(otherMail) tasks.push(`<div class="item-row"><div class="item-icon">✉</div><div class="item-main"><div class="item-title">${otherMail} other Yahoo update${otherMail===1?'':'s'}</div></div><button type="button" class="button button-quiet small" data-view="inbox">Review</button></div>`);
    $('#overviewTasks').innerHTML = tasks.slice(0,6).join('') || empty('All caught up. Nothing needs attention.', '✓');
    const stageCounts = ['Applied', 'Screening', 'Interview', 'Final Round', 'Offer'];
    const total = Math.max(db.jobs.length, 1);
    $('#overviewPipeline').innerHTML = stageCounts.map(stage => { const count = db.jobs.filter(j => j.stage === stage).length; return `<div class="pipeline-item"><div class="pipeline-label"><span>${esc(stage)}</span><span>${count}</span></div><div class="progress-track"><div class="progress-fill" style="width:${count / total * 100}%"></div></div></div>`; }).join('');
  }
  function renderCalendar() {
    const month = displayMonth.getMonth(), year = displayMonth.getFullYear();
    $('#calendarMonth').textContent = displayMonth.toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
    const confirmed = db.events.filter(e => !e.cancelled && isValid(parseDate(e.when)));
    const tentative = pendingInterviewCandidates().map(m=>({...m, day: m.when ? dayKey(parseDate(m.when)) : m.dateOnly}));
    const inMonth = confirmed.filter(e => {const d=parseDate(e.when);return d.getFullYear()===year&&d.getMonth()===month;});
    const suggestedMonth = tentative.filter(m=>m.day.startsWith(`${year}-${String(month+1).padStart(2,'0')}`));
    $('#calendarCount').textContent = `${inMonth.length} scheduled · ${suggestedMonth.length} to review`;
    const offset = new Date(year, month, 1).getDay(), daysCount = new Date(year,month+1,0).getDate();
    const total = Math.ceil((offset + daysCount) / 7) * 7;
    const eventsByDay = new Map();
    for (const e of confirmed) {const day=dayKey(parseDate(e.when));if(!eventsByDay.has(day))eventsByDay.set(day,[]);eventsByDay.get(day).push({kind:'saved',item:e});}
    for (const m of tentative) {if(!eventsByDay.has(m.day))eventsByDay.set(m.day,[]);eventsByDay.get(m.day).push({kind:'review',item:m});}
    let html='';
    for(let i=0;i<total;i++) {
      const d=new Date(year,month,i-offset+1),day=dayKey(d),matching=eventsByDay.get(day)||[];
      const interviews=matching.filter(x=>x.kind==='review'||x.item.type==='Interview').length;
      const pending=matching.filter(x=>x.kind==='review').length;
      const selected=day===dayKey(selectedDate);
      html += `<button type="button" class="calendar-day ${d.getMonth()===month?'':'outside'} ${day===dayKey(now())?'today':''} ${selected?'selected':''}" data-select-day="${day}" aria-label="${esc(d.toDateString())}: ${interviews} interviews, ${pending} need review, ${matching.length} items" aria-pressed="${selected}"><span class="day-number">${d.getDate()}</span>${interviews ? `<span class="calendar-interview-count">${interviews} interview${interviews===1?'':'s'}</span>` : matching.length ? `<span class="calendar-other-count">${matching.length} task${matching.length===1?'':'s'}</span>` : ''}${pending?'<span class="calendar-needs-review">To check</span>':''}</button>`;
    }
    $('#calendarGrid').innerHTML=html;
    const day=dayKey(selectedDate),items=eventsByDay.get(day)||[];
    const interviewCount=items.filter(x=>x.kind==='review'||x.item.type==='Interview').length;
    const reviewCount=items.filter(x=>x.kind==='review').length;
    $('#selectedDateTitle').textContent=selectedDate.toLocaleDateString(undefined,{month:'long',day:'numeric',weekday:'short'});
    $('#selectedDateCount').textContent=`${interviewCount} interview${interviewCount===1?'':'s'}${reviewCount?' · '+reviewCount+' to confirm':''}${!interviewCount?' · '+items.length+' other item'+(items.length===1?'':'s'):''}`;
    items.sort((a,b)=>{
      const av=a.item.when ? parseDate(a.item.when).getTime():Number.MAX_SAFE_INTEGER;
      const bv=b.item.when ? parseDate(b.item.when).getTime():Number.MAX_SAFE_INTEGER;
      return av-bv;
    });
    $('#selectedDayEvents').innerHTML=items.map(({kind,item:e})=>{
      if(kind==='review') return `<div class="detail-event tentative-event"><div class="time">${e.when?esc(fmtTime(e.when)):'Time to confirm'} · NEEDS REVIEW</div><h3>${esc(e.company||e.role||'Interview invitation')}</h3><p>${esc(e.role||e.subject||'Possible interview from Yahoo')}</p><div class="detail-actions"><button type="button" class="button button-primary small" data-find-mail="${esc(e.id)}">Review invitation</button></div></div>`;
      return `<div class="detail-event ${e.type==='Interview'?'interview-border':e.type==='Follow-up'?'followup-border':e.type==='Deadline'?'deadline-border':''}"><div class="time">${esc(fmtTime(e.when))}${e.completed?' · COMPLETED':''} · ${durationOf(e)} min</div><h3>${esc(e.company||e.title)}</h3><p>${esc(e.company?e.title:e.type)}</p>${e.notes?`<p>${esc(e.notes)}</p>`:''}${safeUrl(e.meetingLink)?`<p><a class="inline-link" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(e.meetingLink))}">Join meeting ↗</a></p>`:''}<div class="detail-actions"><button type="button" class="button button-quiet small" data-edit-event="${esc(e.id)}">Edit</button><button type="button" class="button button-quiet small" data-download-ics="${esc(e.id)}">Export</button>${['Follow-up','Deadline'].includes(e.type)?`<button type="button" class="button button-quiet small" data-${e.completed?'reopen-event':'complete'}="${esc(e.id)}">${e.completed?'Reopen':'Done'}</button>`:''}<button type="button" class="button button-danger-ghost small" data-delete-event="${esc(e.id)}">Delete</button></div></div>`;
    }).join('')||empty('No interviews or tasks on this date.','▦');
  }
  function renderJobs() {
    const search = $('#jobSearch').value.trim().toLowerCase(), stage = $('#stageFilter').value;
    const jobs = db.jobs.filter(j => (stage === 'All' || j.stage === stage || (stage === 'High priority' && j.priority === 'High' && !['Offer','Rejected'].includes(j.stage))) && [j.company, j.role, j.recruiter, j.email, j.source].some(v => String(v || '').toLowerCase().includes(search))).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    $('#jobList').innerHTML = jobs.map(j => {
      const history = Array.isArray(j.stageHistory) ? j.stageHistory : [];
      const last = history.length ? history[history.length-1] : null;
      const url = safeUrl(j.jobUrl);
      return `<article class="job-card"><div class="job-head"><div><h3>${esc(j.company)}</h3><p>${esc(j.role || 'Position not specified')}</p></div><span class="mini-tag ${stageClass(j.stage)}">${esc(j.stage)}</span></div><div class="job-metadata">${j.priority === 'High' ? '<span class="mini-tag high-priority">★ High priority</span>' : ''}${j.appliedAt ? `<span>Applied ${esc(isoDate(j.appliedAt))}</span>` : ''}${j.source ? `<span>From ${esc(j.source)}</span>` : ''}${last ? `<span>Stage changed ${esc(fmtDate(last.at))}</span>` : ''}</div>${j.notes ? `<p class="setting-description" style="margin-top:11px">${esc(j.notes)}</p>` : ''}${history.length ? `<details class="history"><summary>Stage history (${history.length})</summary><ol>${history.slice(-6).reverse().map(h=>`<li>${esc(h.from)} → ${esc(h.to)} · ${esc(fmtDate(h.at))}</li>`).join('')}</ol></details>` : ''}<div class="job-footer"><div class="job-footnote">${j.recruiter ? `Recruiter: ${esc(j.recruiter)} · ` : ''}${j.email ? `${esc(j.email)} · ` : ''}Updated ${esc(fmtDate(j.updatedAt || j.createdAt))}${url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Job posting ↗</a>` : ''}</div><div class="job-controls"><select aria-label="Stage for ${esc(j.company)}" data-stage-job="${esc(j.id)}">${STAGES.map(s=>`<option value="${esc(s)}" ${j.stage === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select><button type="button" class="button button-quiet small" data-followup-job="${esc(j.id)}">Follow up</button><button type="button" class="button button-quiet small" data-edit-job="${esc(j.id)}">Edit</button><button type="button" class="button button-danger-ghost small" data-delete-job="${esc(j.id)}">Delete</button></div></div></article>`;
    }).join('') || empty(db.jobs.length ? 'No applications match these filters.' : 'No applications yet. Add one to start tracking.', '▤');
  }
  function renderInbox() {
    const pending = pendingMails().sort((a,b)=>Number(b.category==='interview')-Number(a.category==='interview') || String(b.receivedAt).localeCompare(String(a.receivedAt)));
    $('#reviewCount').textContent = pending.length;
    $('#reviewList').innerHTML = pending.slice(0, 80).map(m => mailCard(m, true)).join('') || empty(db.lastSyncAt ? 'All caught up. No emails need your approval.' : 'Your recruitment emails will appear here after the first check.', '✓');
    $('#mailHistory').innerHTML = db.mailbox.filter(m => m.status !== 'pending').sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 20).map(m => mailCard(m, false)).join('') || empty('No processed messages yet.', '✉');
    const connected = Boolean(db.lastSyncAt && key && !syncError);
    $('#syncStatus').classList.toggle('connected', connected);
    $('#syncHeadline').textContent = syncError ? 'Yahoo needs attention' : connected ? 'Yahoo is connected' : key ? 'Ready to check Yahoo' : 'Connect Yahoo once';
    const scanAge = db.lastScanAt && isValid(parseDate(db.lastScanAt)) ? (Date.now() - Date.parse(db.lastScanAt)) / 3600000 : null;
    $('#syncDescription').textContent = syncError || (connected ? `Last checked ${fmtDateTime(db.lastSyncAt)}. ${scanAge != null && scanAge > 3 ? 'Yahoo background checks appear delayed.' : 'New messages are checked automatically; tap Check now to refresh.'}` : key ? 'Your key is saved. Tap Check now to see recruitment emails.' : 'Save your existing Yahoo sync key in Settings. You only need to do this once on this iPhone.');
    $('#syncInfoAction').hidden = connected;
    $('#syncStatus').classList.toggle('stale',scanAge != null && scanAge > 3);

    $('#syncInbox').disabled = syncBusy;
    $('#quickSync').disabled = syncBusy;
  }
  function mailCard(m, pending) {
    const category = ({interview: 'Interview', interview_cancelled: 'Cancellation', application: 'Application', rejection: 'Decision', offer: 'Offer', assessment: 'Assessment', followup: 'Follow-up', other: 'Recruitment'})[m.category] || 'Recruitment';
    const status = ({approved: 'Added to planner', dismissed: 'Dismissed', auto: 'Automatically added'})[m.status] || '';
    return `<div class="mail-card" id="mail-${esc(m.id)}"><div class="mail-top"><span class="mail-category">${esc(category)} · ${esc(m.company || m.sender || 'Unknown company')}</span><span class="status-text">${esc(fmtDate(m.receivedAt))}</span></div><h3>${esc(m.subject || 'Untitled message')}</h3><p>From ${esc(m.sender || m.fromEmail || 'Unknown sender')}</p>${m.preview ? `<p class="mail-preview">${esc(m.preview)}</p>` : ''}<div class="mail-summary">${m.stageSuggestion ? `<span>Stage: ${esc(m.stageSuggestion)}</span>` : ''}${m.when ? `<span>▦ ${esc(fmtDateTime(m.when))}</span>` : m.dateOnly ? `<span>▦ ${esc(isoDate(m.dateOnly))} · time to confirm</span>` : ''}${m.dateConfidence === 'medium' ? '<span>⚠ Check extracted date</span>' : ''}${m.cancelled ? '<span>⚠ Cancellation detected</span>' : ''}</div>${pending ? `<div class="mail-actions">${m.category === 'interview' && !m.when ? '' : `<button type="button" class="button button-primary small" data-approve-mail="${esc(m.id)}">${m.category === 'interview' ? 'Add interview' : 'Approve update'}</button>`}<button type="button" class="button button-quiet small" data-dismiss-mail="${esc(m.id)}">Dismiss</button>${m.when || m.dateOnly ? `<button type="button" class="button button-quiet small" data-edit-mail-event="${esc(m.id)}">${m.when ? 'Check time / details' : 'Set interview time'}</button>` : ''}</div>` : `<p class="status-text" style="margin-top:10px">${esc(status)}</p>`}</div>`;
  }
  function renderSettings() {
    $('#lastSyncLabel').textContent = db.lastSyncAt ? fmtDateTime(db.lastSyncAt) : 'Never';
    $('#lastScanLabel').textContent = db.lastScanAt ? fmtDateTime(db.lastScanAt) : 'Not connected';
    $('#remindersEnabled').checked = Boolean(db.reminderEnabled);
    const saved = Boolean(localStorage.getItem(DEVICE_KEY) && key);
    $('#yahooConnectedPanel').hidden = !key;
    $('#yahooSetupPanel').hidden = Boolean(key && !editingSyncKey);
    $('#yahooKeyNote').textContent = saved ? 'Key saved on this iPhone. JobPilot will open and check Yahoo without asking again.' : 'Key unlocked for this session. Persistent storage was not available.';
    $('#syncKeyMessage').textContent = syncError ? 'Sync problem: ' + syncError : saved ? 'No need to enter the key again unless you clear website data or choose Forget this device.' : key ? 'If your browser allows device storage, saving the key again will remember it.' : 'Paste the existing key from your GitHub setup. Do not generate a new key if your Yahoo scanner already works.';
    $('#yahooSetupGuide').hidden = Boolean(key && db.lastSyncAt && !syncError);
    if ('Notification' in window) $('#notificationStatus').textContent = `On-screen alerts: ${Notification.permission}. For closed-app push notifications, use Cloud Push below.`;
  }
  function fieldsFor(type, data = {}) {
    const field = (name, label, kind, options = {}) => {
      let value = data[name] ?? options.defaultValue ?? '';
      if (kind === 'datetime-local' && value && isValid(parseDate(value))) value = localInputValue(parseDate(value));
      const wide = options.wide ? 'wide' : '';
      const req = options.required ? 'required' : '';
      let input;
      if (kind === 'select') input = `<select id="field-${name}" name="${name}" ${req}>${options.values.map(v => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
      else if (kind === 'textarea') input = `<textarea id="field-${name}" name="${name}" placeholder="${esc(options.placeholder || '')}">${esc(value)}</textarea>`;
      else input = `<input id="field-${name}" name="${name}" type="${kind}" value="${esc(value)}" placeholder="${esc(options.placeholder || '')}" ${req}>`;
      return `<div class="field ${wide}"><label for="field-${name}">${esc(label)}</label>${input}</div>`;
    };
    if (type === 'job') return [
      field('company', 'Company', 'text', {required:true,placeholder:'e.g. Microsoft'}),
      field('role', 'Job title', 'text', {required:true,placeholder:'e.g. Workday Analyst'}),
      field('stage', 'Current stage', 'select', {values:STAGES,defaultValue:'Applied'}),
      field('priority', 'Priority', 'select', {values:['Normal','High','Low'],defaultValue:'Normal'}),
      field('appliedAt', 'Date applied', 'date', {defaultValue:dayKey(now())}),
      field('source', 'Application source', 'text', {placeholder:'Company website, LinkedIn…'}),
      field('recruiter', 'Recruiter name', 'text'),field('email', 'Recruiter email', 'email'),
      field('jobUrl','Job posting URL','url',{wide:true,placeholder:'https://careers.example.com/…'}),
      field('notes','Notes / next steps','textarea',{wide:true,placeholder:'Recruiter conversations, interview rounds…'})
    ].join('');
    const start = data.when && isValid(parseDate(data.when)) ? localInputValue(parseDate(data.when)) : localInputValue(new Date(Date.now() + 3600000));
    return [
      field('title','Event title','text',{required:true,placeholder:'Interview with recruiter'}),
      field('company','Company','text'),
      field('when','Date and time','datetime-local',{required:true,defaultValue:start}),
      field('duration','Duration (minutes)','select',{values:['15','30','45','60','90','120'],defaultValue:'60'}),
      field('type','Type','select',{values:EVENT_TYPES,defaultValue:'Interview'}),
      field('meetingLink','Meeting URL','url',{wide:true,placeholder:'https://meet.google.com/...'}),
      field('notes','Notes','textarea',{wide:true,placeholder:'Meeting details, recruiter, prep notes...'})
    ].join('');
  }
  function openEditor(type, id = '', template = null) {
    editorMode = type; editorId = id;
    const existing = template || (type === 'job' ? db.jobs.find(j => j.id === id) : db.events.find(e => e.id === id)) || {};
    $('#editorHeading').textContent = `${id ? 'Edit' : 'New'} ${type === 'job' ? 'application' : 'event'}`;
    $('#editorFields').innerHTML = fieldsFor(type, existing);
    $('#submitEditor').textContent = id ? 'Save changes' : `Add ${type === 'job' ? 'application' : 'event'}`;
    $('#editorModal').showModal();
  }
  function closeEditor() { $('#editorModal').close(); editorMode = null; editorId = ''; editorMailId = ''; }
  function submitEditor(ev) {
    ev.preventDefault();
    const fields = Object.fromEntries(new FormData(ev.target).entries());
    if (editorMode === 'event') {
      const when = new Date(fields.when);
      if (!isValid(when)) return toast('Please choose a valid date and time.');
      if (fields.meetingLink && !safeUrl(fields.meetingLink)) return toast('Meeting URL must begin with https:// or http://');
      fields.when = when.toISOString();
      fields.duration = Math.max(15,Math.min(120,Number(fields.duration)||60));
      const clashes = conflicting(fields, editorId);
      if (clashes.length && !confirm(`Scheduling conflict with ${clashes.length} other event(s): ${clashes.slice(0,2).map(c=>c.title).join(', ')}. Save anyway?`)) return;
      const old = db.events.find(x => x.id === editorId);
      if (old) {delete old.end;Object.assign(old, fields, {userEdited: true, updatedAt: now().toISOString()});}
      else db.events.push({id: uid(), ...fields, ...(editorMailId?{sourceId:editorMailId}:{}), completed: false, cancelled: false, createdAt: now().toISOString()});
      if(editorMailId) {const m=db.mailbox.find(m=>m.id===editorMailId);if(m&&m.status==='pending') {const job=findOrCreateJob(m);if(job&&m.stageSuggestion==='Interview')logStage(job,'Interview','Yahoo approval');m.status='approved';m.processedAt=now().toISOString();}}
    } else if (editorMode === 'job') {
      if (fields.jobUrl && !safeUrl(fields.jobUrl)) return toast('Job posting URL must start with https:// or http://.');
      const old = db.jobs.find(x => x.id === editorId);
      if (old) {const nextStage=fields.stage;delete fields.stage;Object.assign(old,fields,{updatedAt:now().toISOString()});logStage(old,nextStage);}
      else db.jobs.unshift({id:uid(),...fields,stageHistory:[],createdAt:now().toISOString(),updatedAt:now().toISOString()});
    } else return;
    closeEditor(); save(); toast('Saved to your planner.');
  }
  function findOrCreateJob(m) {
    const company = String(m.company || '').trim();
    const role = String(m.role || '').trim();
    if (!company) return null;
    let job = db.jobs.find(j => j.company.trim().toLowerCase() === company.toLowerCase() && (!role || !j.role || j.role.toLowerCase() === role.toLowerCase()));
    if (!job) {
      job = {id: uid(), company, role, stage: 'Applied', recruiter: m.sender || '', email: m.fromEmail || '', notes: 'Detected from Yahoo Mail. Review for accuracy.', sourceId: m.id, createdAt: m.receivedAt || now().toISOString(), updatedAt: now().toISOString()};
      db.jobs.unshift(job);
    }
    return job;
  }
  function applyMail(m, automatic = false) {
    if (!m || m.status !== 'pending') return;
    const job = findOrCreateJob(m);
    if (m.stageSuggestion && job && !automatic) {
      const next = m.stageSuggestion;
      if (STAGES.includes(next)) logStage(job, next, 'Yahoo approval');
      job.updatedAt = now().toISOString();
    } else if (automatic && job && m.stageSuggestion === 'Interview') {
      if (!['Offer','Rejected'].includes(job.stage)) logStage(job, 'Interview', 'Yahoo invite');
      job.updatedAt = now().toISOString();
    }
    if (m.cancelled && m.calendarUid) {
      const affected = db.events.filter(e => e.calendarUid === m.calendarUid);
      affected.forEach(e => { e.cancelled = true; e.updatedAt = now().toISOString(); });
    }
    if (['interview','assessment','followup'].includes(m.category) && m.when && isValid(parseDate(m.when)) && !m.cancelled) {
      const existing = db.events.find(e => e.sourceId === m.id || (m.calendarUid && e.calendarUid === m.calendarUid));
      if (existing && m.calendarUid && m.dateConfidence === 'high' && !existing.userEdited) {
        existing.when = new Date(m.when).toISOString();
        existing.end = m.end || existing.end;
        existing.meetingLink = safeUrl(m.meetingLink) || existing.meetingLink;
        existing.updatedAt = now().toISOString();
        existing.cancelled = false;
      }
      if (!existing && isValid(parseDate(m.when))) db.events.push({id: uid(), title: m.title || `${m.category === 'interview' ? 'Interview' : m.category === 'assessment' ? 'Assessment' : 'Recruitment event'}${m.company ? ' · ' + m.company : ''}`, company: m.company || '', when: new Date(m.when).toISOString(), end: m.end || '', type: m.category === 'interview' ? 'Interview' : m.category === 'followup' ? 'Follow-up' : 'Deadline', meetingLink: safeUrl(m.meetingLink), notes: `From Yahoo: ${m.subject || ''}${m.location ? ' · ' + m.location : ''}${m.dateConfidence === 'medium' ? ' · Verify the extracted date and timezone.' : ''}`, completed: false, cancelled: false, sourceId: m.id, calendarUid: m.calendarUid || '', createdAt: now().toISOString()});
    }
    m.status = automatic ? 'auto' : 'approved';
    m.processedAt = now().toISOString();
  }
  function mergeFeed(feed) {
    if (!feed || feed.version !== 1 || !Array.isArray(feed.messages)) throw Error('Invalid feed format');
    let fresh = 0, automatic = 0;
    const previous = new Set([...(db.seenMailIds || []), ...db.mailbox.map(m => m.id)]);
    for (const record of feed.messages) {
      if (!record || typeof record.id !== 'string' || record.id.length > 120) continue;
      if (!record.subject || typeof record.subject !== 'string') continue;
      if (previous.has(record.id)) {
        const existing = db.mailbox.find(m=>m.id===record.id);
        if (existing && existing.status === 'pending') {
          // Preserve approval decisions; improve unreviewed dates after parser upgrades.
          const improvedTime = record.when && isValid(parseDate(record.when)) && (!existing.when || existing.dateConfidence==='none' || existing.dateConfidence==='date-only');
          const improvedDay = record.dateOnly && !existing.dateOnly && !existing.when;
          if (improvedTime || improvedDay) Object.assign(existing, {when:improvedTime?record.when:existing.when, dateOnly:record.dateOnly||existing.dateOnly, dateConfidence:record.dateConfidence, end:record.end||existing.end, calendarUid:record.calendarUid||existing.calendarUid, meetingLink:record.meetingLink||existing.meetingLink, title:record.title||existing.title});
        }
        continue;
      }
      const mail = {...record, status: 'pending'};
      db.mailbox.push(mail);
      previous.add(mail.id);
      fresh++;
      const manuallyEditedExisting = Boolean(mail.calendarUid && db.events.some(e => e.calendarUid === mail.calendarUid && e.userEdited));
      const confidentInvite = !manuallyEditedExisting && mail.category === 'interview' && mail.dateConfidence === 'high' && mail.when && !mail.cancelled && isValid(parseDate(mail.when)) && parseDate(mail.when) > now();
      // A real calendar attachment with a future start time is sufficiently clear to import.
      if (confidentInvite) { applyMail(mail, true); automatic++; }
      if (mail.category === 'application' && mail.stageSuggestion === 'Applied' && mail.company) { findOrCreateJob(mail); mail.status = 'auto'; automatic++; }
    }
    db.mailbox.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
    db.mailbox = db.mailbox.slice(0, 400);
    db.seenMailIds = [...previous].slice(-3000);
    db.lastSyncAt = now().toISOString();
    db.lastScanAt = feed.generatedAt || '';
    save();
    return {fresh, automatic};
  }
  const hexByte = keyHex => Uint8Array.from(keyHex.match(/.{2}/g).map(x => parseInt(x, 16)));
  const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  async function unlockFeed(container, secret) {
    const cleanKey = secret.trim().replace(/\s+/g, '');
    if (!/^[a-f0-9]{64}$/i.test(cleanKey)) throw Error('Sync key must be 64 hexadecimal characters.');
    if (!window.crypto?.subtle) throw Error('Encrypted sync requires HTTPS or localhost.');
    if (container.version !== 1 || container.cipher !== 'AES-256-GCM') throw Error('Unsupported encrypted feed format.');
    const cryptoKey = await crypto.subtle.importKey('raw', hexByte(cleanKey), {name: 'AES-GCM'}, false, ['decrypt']);
    try {
      const raw = await crypto.subtle.decrypt({name: 'AES-GCM', iv: fromBase64(container.nonce), additionalData: new TextEncoder().encode('jobpilot-feed-v1')}, cryptoKey, fromBase64(container.data));
      return JSON.parse(new TextDecoder().decode(raw));
    } catch { throw Error('Could not decrypt feed. Check that the website and GitHub secret use the same sync key.'); }
  }
  async function syncFeed() {
    if (syncBusy) return;
    if (!key) { editingSyncKey = true; setView('settings'); toast('Save your existing Yahoo key once on this iPhone.'); return; }
    syncBusy = true; syncError = ''; renderInbox();
    try {
      const response = await fetch(`./feed.json?refresh=${Date.now()}`, {cache: 'no-store'});
      if (!response.ok) throw Error(response.status === 404 ? 'No encrypted Yahoo feed yet. Run the GitHub Actions scanner after adding secrets.' : `Feed request failed (HTTP ${response.status}).`);
      const decrypted = await unlockFeed(await response.json(), key);
      const {fresh, automatic} = mergeFeed(decrypted);
      toast(`Synced. ${fresh} new email${fresh === 1 ? '' : 's'}, ${automatic} automatic import${automatic === 1 ? '' : 's'}.`);
    } catch (err) { syncError = err.message || 'Unable to synchronize.'; toast(syncError); }
    finally { syncBusy = false; paint(); }
  }
  function saveKey() {
    const supplied = $('#syncKeyInput').value.trim().replace(/\s+/g, '');
    if (!/^[0-9a-f]{64}$/i.test(supplied)) return toast('The sync key must be exactly 64 hex characters.');
    key = supplied.toLowerCase();
    let remembered = false;
    try { localStorage.setItem(DEVICE_KEY, key); remembered = true; sessionStorage.removeItem(SESSION_KEY); }
    catch { try { sessionStorage.setItem(SESSION_KEY, key); } catch { /* No browser storage available. */ } }
    editingSyncKey = false;
    syncError = '';
    $('#syncKeyInput').value = '';
    $('#syncKeyInput').type = 'password';
    $('#showSyncKey').textContent = 'Show';
    paint();
    toast(remembered ? 'Yahoo saved on this device. No need to enter the key again.' : 'Unlocked, but this browser cannot remember the key after closing.');
    if (location.protocol.startsWith('http')) syncFeed();
  }
  function generateKey() {
    if (key && !confirm('Your Yahoo scanner already has a key. A new key will break sync until you update JOBPILOT_SYNC_KEY in GitHub. Continue?')) return;
    editingSyncKey = true;
    $('#yahooSetupPanel').hidden = false;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const randomKey = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
    $('#syncKeyInput').type = 'text';
    $('#syncKeyInput').value = randomKey;
    toast('New key generated. Only save it after updating the matching GitHub secret.');
  }
  async function copyKey() {
    const value = $('#syncKeyInput').value.trim() || key;
    if (!value) return toast('Generate or enter a key first.');
    try { await navigator.clipboard.writeText(value); toast('Sync key copied. Store it securely.'); }
    catch { $('#syncKeyInput').type = 'text'; $('#syncKeyInput').value = value; $('#syncKeyInput').select(); toast('Copy the selected key manually.'); }
  }
  function exportJobsCsv() {
    const headers = ['Company','Role','Stage','Priority','Applied','Source','Recruiter','Email','Job URL','Notes'];
    const csvCell = text => '"' + String(text ?? '').replace(/^[=+@-]/,'\u0027$&').replace(/"/g,'""').replace(/\r?\n/g,' ') + '"';
    const rows = db.jobs.map(j=>[j.company,j.role,j.stage,j.priority,j.appliedAt,j.source,j.recruiter,j.email,j.jobUrl,j.notes].map(csvCell).join(','));
    downloadBlob(new Blob([[headers.map(csvCell).join(','),...rows].join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'}),`jobpilot-applications-${dayKey(now())}.csv`);
    toast('Application CSV exported.');
  }
  function downloadJson() {
    const payload = {version: 2, exportedAt: now().toISOString(), jobs: db.jobs, events: db.events, mailbox: db.mailbox, seenMailIds: db.seenMailIds, lastSyncAt: db.lastSyncAt, lastScanAt: db.lastScanAt, reminderEnabled: db.reminderEnabled};
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = href; a.download = `jobpilot-backup-${dayKey(now())}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1500);
  }
  async function importJson(ev) {
    const file = ev.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 5_000_000) throw Error('Backup is larger than 5 MB.');
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.jobs) || !Array.isArray(data.events) || data.jobs.length > 10000 || data.events.length > 10000) throw Error('Invalid JobPilot backup.');
      if (!confirm('Replace this device’s planner data with the imported backup?')) return;
      db = {...defaultDb(), ...data, mailbox: Array.isArray(data.mailbox) ? data.mailbox : [], seenMailIds: Array.isArray(data.seenMailIds) ? data.seenMailIds : []};
      save(); toast('Backup restored.');
    } catch (e) { toast(e.message || 'Could not import backup.'); }
    finally { ev.target.value = ''; }
  }
  function checkReminders() {
    if (!db.reminderEnabled) return;
    let changed = false;
    const ageMs = now().getTime();
    for (const e of db.events) {
      if (e.completed || e.cancelled || !isValid(parseDate(e.when))) continue;
      const deltaMinutes = (parseDate(e.when).getTime() - ageMs) / 60000;
      const milestones = [1440, 60, 15];
      for (const m of milestones) {
        if (deltaMinutes > m || deltaMinutes < m - 2) continue;
        const alertId = `${e.id}:${m}`;
        if (db.alertIds[alertId]) continue;
        db.alertIds[alertId] = new Date().toISOString(); changed = true;
        toast(`${e.title}: ${m === 1440 ? '24 hours' : m === 60 ? '1 hour' : '15 minutes'} remaining.`);
        if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification('JobPilot interview reminder', {body: `${e.title} · ${fmtDateTime(e.when)}`, icon: './icon.svg', tag: alertId}); } catch { /* Inline alert remains available */ }
        }
      }
    }
    if (changed) save(false);
  }
  function seedDemo() {
    const id = 'demo-' + uid();
    db.mailbox.unshift({id, subject: 'Interview confirmation — Product Analyst', sender: 'Sample Recruiting Team', fromEmail: 'sample@example.com', receivedAt: now().toISOString(), company: 'Sample Company', role: 'Product Analyst', preview: 'This is sample data only. We would like to invite you to an interview. Please verify the proposed date before accepting.', category: 'interview', stageSuggestion: 'Interview', when: new Date(Date.now() + 3 * 86400000).toISOString(), dateConfidence: 'medium', status: 'pending'});
    save(); setView('inbox'); toast('Added one clearly labeled sample message for testing.');
  }
  function handleClick(ev) {
    const btn = ev.target.closest('button'); if (!btn) return;
    const data = btn.dataset;
    if (data.view) return setView(data.view);
    if (data.action === 'add-job') return openEditor('job');
    if (data.action === 'add-event') {
      const when=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),selectedDate.getDate(),9,0);
      if (dayKey(when) === dayKey(now()) && when < now()) {
        when.setTime(Date.now()+3600000);when.setMinutes(0,0,0);
      }
      return openEditor('event','',{when:when.toISOString()});
    }
    if (data.selectDay) { const [y, m, d] = data.selectDay.split('-').map(Number); selectedDate = new Date(y, m - 1, d); displayMonth = new Date(y, m - 1, 1); return renderCalendar(); }
    if (data.openDay) { const [y,m,d]=data.openDay.split('-').map(Number);if(y&&m&&d){selectedDate=new Date(y,m-1,d);displayMonth=new Date(y,m-1,1);setView('calendar');}return; }
    if (data.findMail) {setView('inbox');const card=document.getElementById(`mail-${data.findMail}`);if(card)card.scrollIntoView({behavior:'smooth',block:'center'});return;}
    if (data.editJob) return openEditor('job', data.editJob);
    if (data.followupJob) {
      const job = db.jobs.find(j => j.id === data.followupJob);
      if (!job) return;
      const when = new Date(); when.setDate(when.getDate()+3); when.setHours(10,0,0,0);
      return openEditor('event','',{title:`Follow up with ${job.company}`,company:job.company,type:'Follow-up',duration:15,when:when.toISOString(),notes:`Regarding ${job.role || 'the application'}${job.email ? ' · Recruiter: '+job.email : ''}`});
    }
    if (data.downloadIcs) { const event = db.events.find(e => e.id === data.downloadIcs); if(event) exportCalendar([event],`jobpilot-event-${dayKey(parseDate(event.when))}.ics`); return; }
    if (data.snoozeEvent) {const e=db.events.find(e=>e.id===data.snoozeEvent); if(!e)return;const d=new Date();d.setDate(d.getDate()+1);d.setHours(10,0,0,0);e.when=d.toISOString();e.completed=false;e.userEdited=true;e.updatedAt=now().toISOString();save();toast('Moved task to tomorrow at 10 AM.');return;}
    if (data.reopenEvent) { const e=db.events.find(e=>e.id===data.reopenEvent); if(e){e.completed=false;save();toast('Task reopened.');} return; }
    if (data.dismissInstall) {localStorage.setItem(INSTALL_KEY,'yes');$('#homeInstallTip').hidden=true;return;}

    if (data.editEvent) return openEditor('event', data.editEvent);
    if (data.deleteJob) { if (confirm('Delete this application?')) { db.jobs = db.jobs.filter(j => j.id !== data.deleteJob); save(); } return; }
    if (data.deleteEvent) { if (confirm('Delete this event?')) { db.events = db.events.filter(e => e.id !== data.deleteEvent); save(); } return; }
    if (data.complete) { const e = db.events.find(e => e.id === data.complete); if (e) { e.completed = true; save(); toast('Task marked complete.'); } return; }
    if (data.approveMail) { const m = db.mailbox.find(x => x.id === data.approveMail); applyMail(m); save(); toast('Suggestion approved and applied.'); return; }
    if (data.dismissMail) { const m = db.mailbox.find(x => x.id === data.dismissMail); if (m) { m.status = 'dismissed'; m.processedAt = now().toISOString(); save(); toast('Suggestion dismissed.'); } return; }
    if (data.editMailEvent) { const m = db.mailbox.find(x => x.id === data.editMailEvent); if (!m) return; openEditor('event', '', {title: m.title || m.role || m.subject || 'Interview', company: m.company || '', when: m.when || '', meetingLink: m.meetingLink || '', type: m.category === 'interview' ? 'Interview' : 'Follow-up', notes: `Suggested from Yahoo Mail. ${m.dateOnly ? 'Possible date '+m.dateOnly+'. ' : ''}Confirm the exact time and timezone.`}); editorMailId=m.id; if (!m.when) toast('Enter the confirmed interview date and time before saving.'); return; }
  }
  function setupListeners() {
    document.addEventListener('click', handleClick);
    const changeMonth = offset => {
      const preferred = selectedDate.getDate();
      displayMonth = new Date(displayMonth.getFullYear(),displayMonth.getMonth()+offset,1);
      const max = new Date(displayMonth.getFullYear(),displayMonth.getMonth()+1,0).getDate();
      selectedDate = new Date(displayMonth.getFullYear(),displayMonth.getMonth(),Math.min(preferred,max));
      renderCalendar();
    };
    $('#calendarPrev').addEventListener('click', () => changeMonth(-1));
    $('#calendarNext').addEventListener('click', () => changeMonth(1));
    $('#calendarToday').addEventListener('click', () => { displayMonth = new Date(now().getFullYear(), now().getMonth(), 1); selectedDate = now(); renderCalendar(); });
    $('#jobSearch').addEventListener('input', renderJobs);
    $('#stageFilter').addEventListener('change', renderJobs);
    $('#jobList').addEventListener('change', e => { if (!e.target.matches('[data-stage-job]')) return; const j = db.jobs.find(x => x.id === e.target.dataset.stageJob); if (j && STAGES.includes(e.target.value)) { logStage(j, e.target.value); j.updatedAt = now().toISOString(); save(); toast('Application stage updated.'); } });
    $('#closeEditor').addEventListener('click', closeEditor);
    $('#cancelEditor').addEventListener('click', closeEditor);
    $('#editorForm').addEventListener('submit', submitEditor);
    $('#editorModal').addEventListener('click', e => { if (e.target === $('#editorModal')) closeEditor(); });
    $('#quickSync').addEventListener('click', syncFeed);
    $('#syncInbox').addEventListener('click', syncFeed);
    $('#testFeed').addEventListener('click', syncFeed);
    $('#tryDemo').addEventListener('click', seedDemo);
    $('#themeToggle').addEventListener('click', () => { const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; localStorage.setItem(THEMES_KEY, theme); });
    $('#saveSyncKey').addEventListener('click', saveKey);
    $('#generateSyncKey').addEventListener('click', generateKey);
    $('#copySyncKey').addEventListener('click', copyKey);
    $('#showSyncKey').addEventListener('click', () => { const input = $('#syncKeyInput'); input.type = input.type === 'password' ? 'text' : 'password'; $('#showSyncKey').textContent = input.type === 'password' ? 'Show' : 'Hide'; });
    $('#forgetSyncKey').addEventListener('click', () => { if (!confirm('Forget the saved Yahoo key on this device? Your applications and calendar will stay.')) return; key = ''; editingSyncKey = false; syncError = ''; localStorage.removeItem(DEVICE_KEY); sessionStorage.removeItem(SESSION_KEY); $('#syncKeyInput').value = ''; paint(); toast('Yahoo key forgotten on this device.'); });
    $('#changeSyncKey').addEventListener('click', () => { editingSyncKey = true; $('#yahooSetupPanel').hidden = false; $('#syncKeyInput').value = ''; $('#syncKeyInput').focus(); toast('Paste the original key from your GitHub secret setup.'); });
    $('#remindersEnabled').addEventListener('change', e => { db.reminderEnabled = e.target.checked; save(); checkReminders(); });
    $('#notificationPermission').addEventListener('click', async () => { if (!('Notification' in window)) return toast('This browser does not support notifications.'); try { const result = await Notification.requestPermission(); toast(`Notification permission: ${result}.`); paint(); } catch { toast('Notifications are unavailable in this browser.'); } });
    $('#exportBackup').addEventListener('click', downloadJson);
    $('#exportCalendar').addEventListener('click', () => exportCalendar(db.events,`jobpilot-calendar-${dayKey(now())}.ics`));
    $('#exportJobsCsv').addEventListener('click', exportJobsCsv);
    window.addEventListener('online',paint);window.addEventListener('offline',paint);
    $('#importBackup').addEventListener('change', importJson);
    $('#resetAll').addEventListener('click', () => { if (!confirm('Delete all local applications, events, and mail review history? Export a backup first.')) return; db = defaultDb(); save(); toast('Local planner data cleared.'); });
  }
  function init() {
    document.documentElement.dataset.theme = localStorage.getItem(THEMES_KEY) === 'light' ? 'light' : 'dark';
    setupListeners(); paint();
    if (new URLSearchParams(location.search).get('open') === 'calendar') setView('calendar');
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
    window.setInterval(checkReminders, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); paint(); if (key && !syncBusy && (!db.lastSyncAt || Date.now() - Date.parse(db.lastSyncAt) > 10 * 60 * 1000)) syncFeed(); } });
    checkReminders();
    // Refresh on open when already unlocked. Scanner may not have run on schedule.
    if (key && location.protocol.startsWith('http')) syncFeed();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // Expose test hooks only on localhost. Nothing in here carries a Yahoo password.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__jobpilotTest = {getDb: () => db, mergeFeed, unlockFeed, applyMail, dayKey, setView};
})();
