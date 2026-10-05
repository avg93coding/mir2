'use strict';

const EXAM_DATE = new Date('2027-01-23T14:00:00+01:00');
const STORAGE_KEY = 'mirSprintStateV1';
const DEFAULT_GOAL = 80;

let subjects = [];
let baseCards = [];
let baseQuestions = [];
let cards = [];
let questions = [];
let studyQueue = [];
let studyIndex = 0;
let sessionCount = 0;
let imagesOnly = false;
let currentQuiz = null;
let quizTimerHandle = null;

const defaultState = {
  version: 1,
  dailyGoal: DEFAULT_GOAL,
  cardProgress: {},
  questionStats: {},
  quizHistory: [],
  activity: {},
  customCards: [],
  customQuestions: [],
  theme: 'dark'
};

let state = loadState();

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return raw ? { ...structuredClone(defaultState), ...raw } : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function diffDays(a, b) {
  const x = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const y = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.ceil((y - x) / 86400000);
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function sanitizeHTML(value='') {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(value);
  tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach(el => el.remove());
  tpl.content.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      const n = attr.name.toLowerCase();
      const v = attr.value.trim().toLowerCase();
      if (n.startsWith('on') || (['href','src'].includes(n) && v.startsWith('javascript:'))) el.removeAttribute(attr.name);
      if (n === 'style') {
        const safe = attr.value.replace(/url\s*\([^)]*\)/gi, '').replace(/expression\s*\([^)]*\)/gi, '');
        el.setAttribute('style', safe);
      }
    });
  });
  return tpl.innerHTML;
}

function stripHTML(value='') {
  const div = document.createElement('div');
  div.innerHTML = sanitizeHTML(value);
  return (div.textContent || '').replace(/\s+/g,' ').trim();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function activityForToday() {
  const k = todayKey();
  if (!state.activity[k]) state.activity[k] = { reviewed:0, correct:0, answered:0 };
  return state.activity[k];
}

async function init() {
  try {
    const [s, c, q] = await Promise.all([
      fetch('./data/subjects.json').then(r => r.json()),
      fetch('./data/otorrino-cards.json').then(r => r.json()),
      fetch('./data/questions.json').then(r => r.json())
    ]);
    subjects = s; baseCards = c; baseQuestions = q;
    cards = [...baseCards, ...(state.customCards || [])];
    questions = [...baseQuestions, ...(state.customQuestions || [])];
    wireUI();
    applyTheme();
    populateSelectors();
    renderAll();
    prepareStudy();
    document.getElementById('dataStatus').textContent = `${cards.length} tarjetas · ${questions.length} preguntas`;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  } catch (err) {
    console.error(err);
    document.getElementById('dataStatus').textContent = 'Error al cargar banco';
    toast('No se pudo cargar el banco. Abre la app desde un servidor HTTP, no como archivo local.');
  }
}

function wireUI() {
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => showView(b.dataset.go)));
  document.getElementById('menuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('revealCard').addEventListener('click', revealCard);
  document.querySelectorAll('.rate').forEach(b => b.addEventListener('click', () => rateCard(Number(b.dataset.rating))));
  document.getElementById('studySubject').addEventListener('change', prepareStudy);
  document.getElementById('studyImagesOnly').addEventListener('click', () => { imagesOnly = !imagesOnly; document.getElementById('studyImagesOnly').classList.toggle('primary', imagesOnly); prepareStudy(); });
  document.getElementById('dailyGoal').value = state.dailyGoal || DEFAULT_GOAL;
  document.getElementById('dailyGoal').addEventListener('change', e => { state.dailyGoal = Math.max(10, Math.min(500, Number(e.target.value)||DEFAULT_GOAL)); saveState(); renderDashboard(); renderPlanner(); });
  document.getElementById('resetSession').addEventListener('click', () => { sessionCount=0; prepareStudy(); });
  document.getElementById('restartStudy').addEventListener('click', prepareStudy);
  document.getElementById('startQuiz').addEventListener('click', startQuiz);
  document.getElementById('prevQuestion').addEventListener('click', () => moveQuiz(-1));
  document.getElementById('nextQuestion').addEventListener('click', () => moveQuiz(1));
  document.getElementById('subjectFilter').addEventListener('input', e => renderSubjects(e.target.value));
  document.getElementById('printPlan').addEventListener('click', () => window.print());
  document.getElementById('importJson').addEventListener('change', importJSON);
  document.getElementById('exportProgress').addEventListener('click', exportProgress);
  document.getElementById('clearProgress').addEventListener('click', clearProgress);
  document.getElementById('globalSearch').addEventListener('input', debounce(e => globalSearch(e.target.value), 180));
  document.getElementById('closeSearch').addEventListener('click', () => document.getElementById('searchResults').classList.add('hidden'));
  document.addEventListener('keydown', handleKeyboard);
}

function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t=setTimeout(()=>fn(...args),ms); };
}

function handleKeyboard(e) {
  if (!document.getElementById('view-study').classList.contains('active')) return;
  if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); revealCard(); }
  if (!document.getElementById('answerZone').classList.contains('hidden') && ['Digit1','Digit2','Digit3','Digit4'].includes(e.code)) {
    rateCard(Number(e.code.slice(-1))-1);
  }
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.getElementById('sidebar').classList.remove('open');
  window.scrollTo({top:0,behavior:'smooth'});
  if (name === 'study') prepareStudy();
  if (name === 'subjects') renderSubjects();
  if (name === 'planner') renderPlanner();
}

function populateSelectors() {
  const opts = subjects.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
  document.getElementById('studySubject').insertAdjacentHTML('beforeend', opts);
  const qopts = subjects.filter(s => questions.some(q=>q.subjectId===s.id)).map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  document.getElementById('quizSubject').insertAdjacentHTML('beforeend', qopts);
}

function renderAll() {
  renderDashboard(); renderSubjects(); renderPlanner(); renderLibrary();
}

function renderDashboard() {
  const now = new Date();
  const days = Math.max(0, diffDays(now, EXAM_DATE));
  document.getElementById('countdownDays').textContent = days;
  document.getElementById('statCards').textContent = cards.length;
  const today = activityForToday();
  document.getElementById('statToday').textContent = today.reviewed || 0;
  const due = getDueCards().length;
  document.getElementById('statDue').textContent = `${due} pendientes`;
  const totals = Object.values(state.questionStats || {}).reduce((a,x)=>({c:a.c+(x.correct||0),w:a.w+(x.wrong||0)}),{c:0,w:0});
  const denom=totals.c+totals.w;
  document.getElementById('statAccuracy').textContent = denom ? `${Math.round(totals.c/denom*100)}%` : '—';
  document.getElementById('statStreak').textContent = calculateStreak();
  const goal=state.dailyGoal||DEFAULT_GOAL;
  document.getElementById('sidebarDaily').textContent=`${today.reviewed||0} / ${goal}`;
  document.getElementById('sidebarDailyBar').style.width=`${Math.min(100,(today.reviewed||0)/goal*100)}%`;
  document.getElementById('todayDueText').textContent = due ? `${due} tarjetas vencidas o nuevas disponibles` : 'Sin repasos vencidos: incorpora tarjetas nuevas';
  const phase=getCurrentPhase();
  document.getElementById('phaseTag').textContent=phase.name;
  const high=subjects.filter(s=>s.priority===5);
  document.getElementById('prioritySubject').textContent=high[(now.getDay()+now.getDate())%high.length]?.name || 'Cardiología';
  const coverage=calculateCoverage();
  document.getElementById('coveragePct').textContent=`${coverage.pct}%`;
  document.getElementById('coverageText').textContent=`${coverage.covered} de ${coverage.total} temas tienen al menos una tarjeta o pregunta en este paquete.`;
  document.getElementById('coverageRing').style.background=`conic-gradient(var(--accent) ${coverage.pct*3.6}deg,#1c2d44 0deg)`;
}

function calculateStreak() {
  let streak=0;
  const d=new Date();
  for(let i=0;i<365;i++){
    const k=todayKey(d); const a=state.activity[k];
    if(a && ((a.reviewed||0)+(a.answered||0)>0)){streak++;d.setDate(d.getDate()-1);}
    else if(i===0){d.setDate(d.getDate()-1);continue;}
    else break;
  }
  return streak;
}

function calculateCoverage() {
  const content = new Set();
  cards.forEach(c=>content.add(`${c.subject}::${stripHTML(c.topic)}`.toLowerCase()));
  questions.forEach(q=>content.add(`${q.subject}::${q.topic}`.toLowerCase()));
  let covered=0,total=0;
  subjects.forEach(s=>s.topics.forEach(t=>{total++;if(content.has(`${s.name}::${t}`.toLowerCase())) covered++;}));
  return {covered,total,pct:Math.round(covered/total*100)};
}

function getDueCards() {
  const t=todayKey();
  return cards.filter(c => {
    const p=state.cardProgress[c.id];
    return !p || !p.due || p.due<=t;
  });
}

function prepareStudy() {
  if (!cards.length) return;
  const subject = document.getElementById('studySubject')?.value || 'all';
  let pool = cards.filter(c => subject==='all' || c.subject===subject);
  if (imagesOnly) pool=pool.filter(c=>c.cardType==='image' || /<img/i.test(c.question||''));
  const t=todayKey();
  const due=pool.filter(c=>state.cardProgress[c.id]?.due && state.cardProgress[c.id].due<=t);
  const fresh=pool.filter(c=>!state.cardProgress[c.id]);
  const future=pool.filter(c=>state.cardProgress[c.id]?.due>t);
  studyQueue=[...shuffle(due),...shuffle(fresh),...shuffle(future)].slice(0,Math.max(state.dailyGoal||DEFAULT_GOAL,100));
  studyIndex=0;
  document.getElementById('studyDue').textContent=due.length;
  document.getElementById('studyNew').textContent=fresh.length;
  renderStudyCard();
}

function renderStudyCard() {
  document.getElementById('sessionCount').textContent=sessionCount;
  const card=studyQueue[studyIndex];
  const flash=document.getElementById('flashcard');
  const empty=document.getElementById('studyEmpty');
  if(!card){flash.classList.add('hidden');empty.classList.remove('hidden');return;}
  flash.classList.remove('hidden');empty.classList.add('hidden');
  document.getElementById('cardSubject').textContent=card.subject;
  document.getElementById('cardTopic').textContent=stripHTML(card.topic||'');
  document.getElementById('cardQuestion').innerHTML=sanitizeHTML(card.question||'');
  document.getElementById('cardAnswer').innerHTML=sanitizeHTML(card.answer||'');
  document.getElementById('cardExplanation').innerHTML=sanitizeHTML(card.explanation||'');
  document.getElementById('answerZone').classList.add('hidden');
  document.getElementById('revealCard').classList.remove('hidden');
}

function revealCard() {
  if(!studyQueue[studyIndex]) return;
  document.getElementById('answerZone').classList.remove('hidden');
  document.getElementById('revealCard').classList.add('hidden');
}

function rateCard(rating) {
  const card=studyQueue[studyIndex]; if(!card) return;
  const prev=state.cardProgress[card.id] || {ease:2.5,interval:0,repetitions:0};
  let ease=prev.ease||2.5, interval=prev.interval||0, repetitions=prev.repetitions||0;
  if(rating===0){repetitions=0;interval=1;ease=Math.max(1.3,ease-.20);}
  if(rating===1){repetitions=Math.max(1,repetitions);interval=Math.max(1,Math.round((interval||1)*1.2));ease=Math.max(1.3,ease-.15);}
  if(rating===2){interval=repetitions===0?1:repetitions===1?3:Math.max(2,Math.round(interval*ease));repetitions++;}
  if(rating===3){interval=repetitions<2?4:Math.max(4,Math.round(interval*ease*1.3));repetitions++;ease=Math.min(3.2,ease+.10);}
  state.cardProgress[card.id]={ease:+ease.toFixed(2),interval,repetitions,due:todayKey(addDays(new Date(),interval)),lastReviewed:new Date().toISOString(),lastRating:rating};
  const a=activityForToday();a.reviewed=(a.reviewed||0)+1;
  sessionCount++; studyIndex++; saveState();
  renderDashboard(); renderStudyCard();
}

function startQuiz() {
  const sid=document.getElementById('quizSubject').value;
  const mode=document.getElementById('quizMode').value;
  const wanted=Number(document.getElementById('quizCount').value)||20;
  let pool=questions.filter(q=>sid==='all'||q.subjectId===sid);
  if(mode==='errors') pool=pool.filter(q=>(state.questionStats[q.id]?.wrong||0)>0);
  if(!pool.length){toast('No hay preguntas para esa selección.');return;}
  const selected=shuffle(pool).slice(0,Math.min(wanted,pool.length));
  currentQuiz={items:selected,index:0,answers:Array(selected.length).fill(null),started:Date.now(),minutes:Number(document.getElementById('quizMinutes').value)||0};
  document.getElementById('quizSetup').classList.add('hidden');
  document.getElementById('quizResults').classList.add('hidden');
  document.getElementById('quizRunner').classList.remove('hidden');
  renderQuizQuestion(); startQuizTimer();
}

function renderQuizQuestion() {
  if(!currentQuiz) return;
  const q=currentQuiz.items[currentQuiz.index];
  document.getElementById('quizProgress').textContent=`${currentQuiz.index+1} / ${currentQuiz.items.length}`;
  document.getElementById('quizTopic').textContent=`${q.subject} · ${q.topic}`;
  document.getElementById('questionNumber').textContent=`Pregunta ${currentQuiz.index+1}`;
  document.getElementById('quizQuestion').textContent=q.question;
  const letters=['A','B','C','D','E'];
  document.getElementById('quizOptions').innerHTML=q.options.map((opt,i)=>`<button class="option ${currentQuiz.answers[currentQuiz.index]===i?'selected':''}" data-opt="${i}"><span class="letter">${letters[i]}</span><span>${escapeHtml(opt)}</span></button>`).join('');
  document.querySelectorAll('#quizOptions .option').forEach(b=>b.addEventListener('click',()=>{currentQuiz.answers[currentQuiz.index]=Number(b.dataset.opt);renderQuizQuestion();}));
  document.getElementById('prevQuestion').disabled=currentQuiz.index===0;
  document.getElementById('nextQuestion').textContent=currentQuiz.index===currentQuiz.items.length-1?'Finalizar':'Siguiente →';
}

function moveQuiz(delta) {
  if(!currentQuiz) return;
  if(delta>0 && currentQuiz.index===currentQuiz.items.length-1){finishQuiz();return;}
  currentQuiz.index=Math.max(0,Math.min(currentQuiz.items.length-1,currentQuiz.index+delta));renderQuizQuestion();
}

function startQuizTimer() {
  clearInterval(quizTimerHandle);
  const el=document.getElementById('quizTimer');
  quizTimerHandle=setInterval(()=>{
    if(!currentQuiz) return;
    const elapsed=Math.floor((Date.now()-currentQuiz.started)/1000);
    if(currentQuiz.minutes>0){
      const remain=Math.max(0,currentQuiz.minutes*60-elapsed);el.textContent=formatSeconds(remain);if(remain===0)finishQuiz();
    } else el.textContent=formatSeconds(elapsed);
  },1000);
}

function formatSeconds(s){return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}

function finishQuiz() {
  if(!currentQuiz) return;
  clearInterval(quizTimerHandle);
  let correct=0,wrong=0,blank=0;
  currentQuiz.items.forEach((q,i)=>{
    const ans=currentQuiz.answers[i];
    if(ans===null){blank++;return;}
    const st=state.questionStats[q.id]||{correct:0,wrong:0};
    if(ans===q.correctIndex){correct++;st.correct++;}else{wrong++;st.wrong++;}
    st.last=new Date().toISOString();state.questionStats[q.id]=st;
  });
  const score=correct*3-wrong;
  const answered=correct+wrong;
  const a=activityForToday();a.correct=(a.correct||0)+correct;a.answered=(a.answered||0)+answered;
  state.quizHistory.push({date:new Date().toISOString(),count:currentQuiz.items.length,correct,wrong,blank,score});
  state.quizHistory=state.quizHistory.slice(-100);saveState();
  const quiz=currentQuiz; currentQuiz=null;
  document.getElementById('quizRunner').classList.add('hidden');
  const result=document.getElementById('quizResults');result.classList.remove('hidden');
  result.innerHTML=`<article class="panel"><span class="eyebrow">RESULTADO</span><h2>Simulacro completado</h2><div class="results-card"><div class="result-kpi"><strong>${correct}</strong><span>aciertos</span></div><div class="result-kpi"><strong>${wrong}</strong><span>errores</span></div><div class="result-kpi"><strong>${blank}</strong><span>en blanco</span></div><div class="result-kpi"><strong>${score}</strong><span>puntos brutos (+3/−1)</span></div></div><p class="muted">Precisión sobre respondidas: ${answered?Math.round(correct/answered*100):0}%.</p><button class="primary" id="newQuiz">Nuevo simulacro</button><h2 style="margin-top:28px">Revisión</h2>${quiz.items.map((q,i)=>{const ans=quiz.answers[i];const ok=ans===q.correctIndex;return `<div class="review-item"><strong>${i+1}. ${escapeHtml(q.question)}</strong><p class="${ok?'correct':'wrong'}">Tu respuesta: ${ans===null?'En blanco':escapeHtml(q.options[ans])}</p><p>Correcta: <b>${escapeHtml(q.options[q.correctIndex])}</b></p><p class="muted">${escapeHtml(q.explanation||'')}</p></div>`}).join('')}</article>`;
  document.getElementById('newQuiz').addEventListener('click',()=>{result.classList.add('hidden');document.getElementById('quizSetup').classList.remove('hidden');});
  renderDashboard();
}

function renderSubjects(filter='') {
  const q=filter.trim().toLowerCase();
  const grid=document.getElementById('subjectGrid');
  const list=subjects.filter(s=>!q||s.name.toLowerCase().includes(q)||s.topics.some(t=>t.toLowerCase().includes(q)));
  grid.innerHTML=list.map(s=>{
    const c=cards.filter(x=>x.subject===s.name).length;
    const nq=questions.filter(x=>x.subjectId===s.id).length;
    return `<article class="subject-card"><div class="subject-card-head"><div class="subject-icon">${escapeHtml(s.icon)}</div><div><h3>${escapeHtml(s.name)}</h3><small>Prioridad editorial ${s.priority}/5</small></div></div><div class="subject-topics">${s.topics.map(t=>`<span class="topic-chip">${escapeHtml(t)}</span>`).join('')}</div><div class="subject-meta"><span>${s.topics.length} temas</span><span>${c} tarjetas · ${nq} preguntas</span></div></article>`;
  }).join('') || '<div class="empty-state"><strong>Sin resultados</strong><p>Prueba otro término.</p></div>';
}

const phases=[
  {name:'Vuelta 1',start:'2026-10-04',end:'2026-10-31',desc:'Construir base de alta rentabilidad: cardio, infecciosas, digestivo, neuro, endocrino, pediatría, gine y estadística.',goal:'60–100 tarjetas/día',mocks:1},
  {name:'Vuelta 2',start:'2026-11-01',end:'2026-11-28',desc:'Segunda pasada más rápida, integración clínica y aumento progresivo de preguntas.',goal:'80–120 tarjetas/día',mocks:2},
  {name:'Consolidación',start:'2026-11-29',end:'2026-12-26',desc:'Priorizar fallos, imágenes, algoritmos y simulacros. Reducir lectura pasiva.',goal:'100–160 tarjetas/día',mocks:2},
  {name:'Sprint final',start:'2026-12-27',end:'2027-01-16',desc:'Repaso ultrarrápido, banco de errores, preguntas mixtas y entrenamiento de tiempo.',goal:'120–180 tarjetas/día',mocks:3},
  {name:'Taper',start:'2027-01-17',end:'2027-01-22',desc:'Solo errores de alto rendimiento, fórmulas, imágenes y descanso. Nada de maratones nuevos.',goal:'40–80 tarjetas/día',mocks:0}
];
function getCurrentPhase(){const t=todayKey();return phases.find(p=>t>=p.start&&t<=p.end)|| (t<phases[0].start?phases[0]:phases[phases.length-1]);}
function renderPlanner(){
  const p=getCurrentPhase();const days=Math.max(0,diffDays(new Date(),EXAM_DATE));
  document.getElementById('planDays').textContent=days;document.getElementById('planPhase').textContent=p.name;document.getElementById('planDailyGoal').textContent=state.dailyGoal||DEFAULT_GOAL;document.getElementById('planMocks').textContent=p.mocks;document.getElementById('plannerSubtitle').textContent=`Plan adaptado al 23 de enero de 2027 · ${days} días restantes.`;
  document.getElementById('planTimeline').innerHTML=phases.map(x=>`<article class="phase ${x===p?'active':''}"><div class="phase-date">${formatDate(x.start)}<br>→ ${formatDate(x.end)}</div><div><h3>${escapeHtml(x.name)}</h3><p>${escapeHtml(x.desc)}</p></div><div class="phase-goal"><strong>${escapeHtml(x.goal)}</strong><span>${x.mocks} simulacro(s)/semana</span></div></article>`).join('');
  const week=[['Lunes','Materia A + tarjetas'],['Martes','Materia B + 40 preguntas'],['Miércoles','Materia C + tarjetas'],['Jueves','Materia D + 40 preguntas'],['Viernes','Errores + imágenes'],['Sábado','Simulacro + revisión'],['Domingo','Repaso ligero + descanso']];
  document.getElementById('weekGrid').innerHTML=week.map(([d,t])=>`<div class="day"><strong>${d}</strong><span>${t}</span></div>`).join('');
}
function formatDate(iso){return new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'short'}).format(new Date(`${iso}T12:00:00`));}

function renderLibrary(){document.getElementById('libCards').textContent=cards.length;document.getElementById('libQuestions').textContent=questions.length;document.getElementById('libTopics').textContent=subjects.reduce((n,s)=>n+s.topics.length,0);}

async function importJSON(e){
  const file=e.target.files?.[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());let newCards=[],newQuestions=[];
    if(Array.isArray(data)){if(data[0]?.options)newQuestions=data;else newCards=data;}
    else {newCards=Array.isArray(data.cards)?data.cards:[];newQuestions=Array.isArray(data.questions)?data.questions:[];}
    newCards=newCards.map((c,i)=>({...c,id:c.id||`custom-card-${Date.now()}-${i}`,origin:'custom'})).filter(c=>c.question&&c.answer);
    newQuestions=newQuestions.map((q,i)=>({...q,id:q.id||`custom-q-${Date.now()}-${i}`,origin:'custom'})).filter(q=>q.question&&Array.isArray(q.options)&&Number.isInteger(q.correctIndex));
    state.customCards=[...(state.customCards||[]),...newCards];state.customQuestions=[...(state.customQuestions||[]),...newQuestions];saveState();
    cards=[...baseCards,...state.customCards];questions=[...baseQuestions,...state.customQuestions];renderAll();prepareStudy();toast(`Importados ${newCards.length} tarjetas y ${newQuestions.length} preguntas.`);
  }catch(err){console.error(err);toast('JSON no válido o con estructura incompatible.');}
  e.target.value='';
}

function exportProgress(){
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),app:'MIR Sprint 2027',state},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`mir-sprint-progreso-${todayKey()}.json`;a.click();URL.revokeObjectURL(url);
}
function clearProgress(){if(!confirm('¿Borrar todo el progreso local, incluidos bancos JSON importados?'))return;state=structuredClone(defaultState);saveState();location.reload();}

function globalSearch(term){
  const t=term.trim().toLowerCase();const box=document.getElementById('searchResults');if(t.length<2){box.classList.add('hidden');return;}
  const results=[];
  cards.forEach(c=>{const hay=`${c.subject} ${c.topic} ${stripHTML(c.question)} ${stripHTML(c.answer)}`.toLowerCase();if(hay.includes(t))results.push({type:'Tarjeta',title:stripHTML(c.question).slice(0,110),meta:`${c.subject} · ${c.topic}`});});
  questions.forEach(q=>{const hay=`${q.subject} ${q.topic} ${q.question} ${q.explanation}`.toLowerCase();if(hay.includes(t))results.push({type:'Pregunta',title:q.question,meta:`${q.subject} · ${q.topic}`});});
  subjects.forEach(s=>s.topics.forEach(topic=>{if(`${s.name} ${topic}`.toLowerCase().includes(t))results.push({type:'Tema',title:topic,meta:s.name});}));
  document.getElementById('searchResultsList').innerHTML=results.slice(0,60).map(r=>`<div class="search-result"><strong>${escapeHtml(r.title)}</strong><span>${escapeHtml(r.type)} · ${escapeHtml(r.meta)}</span></div>`).join('')||'<p class="muted">Sin resultados.</p>';
  showView('library');box.classList.remove('hidden');
}

function toggleTheme(){state.theme=state.theme==='light'?'dark':'light';saveState();applyTheme();}
function applyTheme(){document.body.classList.toggle('light',state.theme==='light');}

init();
