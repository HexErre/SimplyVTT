// ============================================================
// OPENVTT — FEATURES PATCH
// Carica questo script DOPO il body principale di index.html
// Richiede che le variabili globali isGM, broadcast, peers,
// showToast, addChatMessage, myName siano già definite.
// ============================================================

(function() {
  // Attendi che l'app sia inizializzata
  const waitForApp = (cb) => {
    if (document.getElementById('app') && typeof showToast !== 'undefined') cb();
    else setTimeout(() => waitForApp(cb), 200);
  };

  waitForApp(() => {

    // ============================================================
    // UTILS COMUNI
    // ============================================================
    const $ = id => document.getElementById(id);
    const el = (tag, cls, html) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html) e.innerHTML = html;
      return e;
    };

    // Aggiungi handler broadcast per le feature
    const originalHandleData = window._handlePeerData;
    window._featureDataHandlers = [];
    window.registerFeatureDataHandler = (fn) => window._featureDataHandlers.push(fn);

    // Intercetta i messaggi P2P in arrivo
    // (hook dopo che il peer è creato - usa MutationObserver sull'indicator)
    const hookPeerData = () => {
      if (!window._featurePeerHooked && window.peer) {
        window._featurePeerHooked = true;
      }
    };
    const featureObserver = new MutationObserver(hookPeerData);
    featureObserver.observe($('conn-indicator'), { attributes: true });

    // Patch broadcast ricevuto — rilancio messaggi alle feature
    const originalBroadcastReceive = window.handleIncomingData;
    window.handleFeatureData = function(data) {
      window._featureDataHandlers.forEach(fn => { try { fn(data); } catch(e){} });
    };

    // ============================================================
    // FEATURE 10: SISTEMA REGOLE
    // ============================================================
    const SYSTEMS = {
      generic: { label: 'Generico', dice: [4,6,8,10,12,20,100], checkCmd: false },
      dnd5e:   { label: 'D&D 5e',   dice: [4,6,8,10,12,20,100], checkCmd: true, checkLabel: '/check <mod>' },
      pf2e:    { label: 'PF 2e',    dice: [4,6,8,10,12,20,100], checkCmd: true, checkLabel: '/check <mod>' },
      osr:     { label: 'OSR',      dice: [4,6,8,10,12,20], checkCmd: false },
    };
    let currentSystem = localStorage.getItem('vtt_system') || 'generic';

    function applySystem(key) {
      currentSystem = key;
      localStorage.setItem('vtt_system', key);
      const sys = SYSTEMS[key] || SYSTEMS.generic;
      // Aggiorna bottom-bar dadi
      const bb = $('bottom-bar');
      if (!bb) return;
      // Rimuovi vecchi pulsanti dado
      bb.querySelectorAll('.die-btn').forEach(b => b.remove());
      sys.dice.forEach(d => {
        const b = document.createElement('button');
        b.className = 'die-btn';
        b.textContent = 'd' + d;
        b.onclick = () => window.rollDice(d);
        bb.appendChild(b);
      });
      if (sys.checkCmd) {
        let cb = $('btn-check-cmd');
        if (!cb) {
          cb = document.createElement('button');
          cb.id = 'btn-check-cmd';
          cb.textContent = '🎯 Check';
          cb.onclick = () => {
            const mod = parseInt(prompt('Modificatore (es: +3, -1):') || '0');
            const roll = Math.floor(Math.random() * 20) + 1;
            const total = roll + mod;
            const txt = `🎯 Check: d20(${roll}) ${mod>=0?'+':''}${mod} = ${total}${roll===20?' 🎉 CRITICO!':roll===1?' 💀 FALLIMENTO CRITICO':''}`;
            if (typeof addChatMessage === 'function') addChatMessage(window.myName||'GM', txt);
            if (typeof broadcast === 'function') broadcast({ type:'chat', sender: window.myName||'GM', text: txt });
          };
          bb.appendChild(cb);
        }
      } else {
        const cb = $('btn-check-cmd');
        if (cb) cb.remove();
      }
      showToast('Sistema: ' + sys.label);
    }

    // Crea dropdown sistema nella toolbar (solo GM)
    const injectSystemDropdown = () => {
      if (!window.isGM) return;
      const toolbar = $('toolbar');
      if (!toolbar || $('system-select')) return;
      const wrap = el('label', '', '');
      wrap.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--text-secondary)';
      wrap.innerHTML = '⚙️ Sistema: ';
      const sel = document.createElement('select');
      sel.id = 'system-select';
      sel.style.cssText = 'background:var(--bg-darker);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:4px 8px;font-size:.8rem;cursor:pointer';
      Object.entries(SYSTEMS).forEach(([k,v]) => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = v.label;
        if (k === currentSystem) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.onchange = () => {
        applySystem(sel.value);
        if (typeof broadcast === 'function') broadcast({ type: 'system_change', system: sel.value });
      };
      wrap.appendChild(sel);
      toolbar.appendChild(wrap);
      applySystem(currentSystem);
    };

    registerFeatureDataHandler(d => {
      if (d.type === 'system_change') {
        currentSystem = d.system;
        applySystem(d.system);
      }
    });

    // ============================================================
    // FEATURE 2: CONDIZIONI NELL'ENCOUNTER TRACKER
    // ============================================================
    const CONDITIONS = [
      { id:'stunned',   emoji:'😵', label:'Stordito' },
      { id:'poisoned',  emoji:'🤢', label:'Avvelenato' },
      { id:'prone',     emoji:'🛌', label:'Prono' },
      { id:'blinded',   emoji:'👁️‍🗨️', label:'Accecato' },
      { id:'frightened',emoji:'😨', label:'Spaventato' },
      { id:'charmed',   emoji:'💜', label:'Affascinato' },
    ];

    // Override renderEncounterList per aggiungere condizioni
    const _origRenderEncounter = window.renderEncounterList;
    window.renderEncounterList = function() {
      const list = $('encounter-list');
      if (!list) return;
      list.innerHTML = '';
      if (!window.encounterEntries) return;
      window.encounterEntries.forEach((entry, idx) => {
        const div = el('div', 'encounter-item' + (idx === window.encounterTurn ? ' active' : ''));
        div.innerHTML = `
          <div style="flex:1">
            <span style="font-weight:600">${entry.name}</span>
            <span style="color:var(--text-muted);font-size:.75rem;margin-left:6px">Init: ${entry.init}</span>
            <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">
              ${(entry.conditions||[]).map(c => `<span class="chip" title="${c.label} (${c.rounds}r)" style="cursor:pointer" onclick="window.removeCondition(${idx},'${c.id}')">${c.emoji} ${c.label} <small>${c.rounds}r</small></span>`).join('')}
            </div>
          </div>
          <div style="display:flex;gap:4px;align-items:center">
            <button onclick="window.showConditionPicker(${idx})" style="padding:2px 6px;font-size:.7rem" title="Aggiungi condizione">+🔧</button>
            <button onclick="window.encounterEntries.splice(${idx},1);window.renderEncounterList()" style="padding:2px 6px;font-size:.7rem;color:var(--accent-danger)">✕</button>
          </div>`;
        list.appendChild(div);
      });
    };

    window.showConditionPicker = function(idx) {
      const entry = window.encounterEntries[idx];
      if (!entry) return;
      const html = CONDITIONS.map(c =>
        `<button onclick="window.addCondition(${idx},'${c.id}');document.getElementById('cond-picker').remove()" style="margin:2px">${c.emoji} ${c.label}</button>`
      ).join('');
      let picker = $('cond-picker');
      if (picker) picker.remove();
      picker = el('div', '', '');
      picker.id = 'cond-picker';
      picker.style.cssText = 'position:fixed;z-index:500;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px;box-shadow:var(--shadow)';
      picker.innerHTML = `<div style="font-size:.8rem;margin-bottom:8px;color:var(--text-secondary)">Condizione per <b>${entry.name}</b></div>${html}<br><input type="number" id="cond-rounds" placeholder="Durata (round)" style="margin-top:6px;width:100%" value="3"><br><button onclick="document.getElementById('cond-picker').remove()" style="margin-top:6px;width:100%">✕ Chiudi</button>`;
      picker.style.top = '120px';
      picker.style.left = '50%';
      picker.style.transform = 'translateX(-50%)';
      document.body.appendChild(picker);
    };

    window.addCondition = function(idx, condId) {
      const entry = window.encounterEntries[idx];
      if (!entry) return;
      const condDef = CONDITIONS.find(c => c.id === condId);
      if (!condDef) return;
      const rounds = parseInt($('cond-rounds')?.value || '3');
      if (!entry.conditions) entry.conditions = [];
      if (!entry.conditions.find(c => c.id === condId)) {
        entry.conditions.push({ ...condDef, rounds });
      }
      window.renderEncounterList();
    };

    window.removeCondition = function(idx, condId) {
      const entry = window.encounterEntries[idx];
      if (!entry || !entry.conditions) return;
      entry.conditions = entry.conditions.filter(c => c.id !== condId);
      window.renderEncounterList();
    };

    // Decrementa condizioni al Next Turn
    const _origNextTurn = window.nextEncounterTurn;
    window.nextEncounterTurn = function() {
      if (typeof _origNextTurn === 'function') _origNextTurn();
      if (!window.encounterEntries) return;
      window.encounterEntries.forEach(entry => {
        if (!entry.conditions) return;
        entry.conditions = entry.conditions.map(c => ({...c, rounds: c.rounds - 1})).filter(c => {
          if (c.rounds <= 0) {
            showToast(`⏰ ${entry.name}: ${c.emoji} ${c.label} scaduta!`);
            return false;
          }
          return true;
        });
      });
      window.renderEncounterList();
    };

    // ============================================================
    // FEATURE 7: DECK DI CARTE
    // ============================================================
    const SUITS = ['♠','♥','♦','♣'];
    const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    let deckCards = [];
    let deckDrawn = [];

    function buildDeck() {
      deckCards = [];
      SUITS.forEach(s => RANKS.forEach(r => deckCards.push(r + s)));
      deckCards.push('🃏 Jolly 1', '🃏 Jolly 2');
    }
    function shuffleDeck() {
      buildDeck();
      deckDrawn = [];
      for (let i = deckCards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deckCards[i], deckCards[j]] = [deckCards[j], deckCards[i]];
      }
      renderDeckPanel();
      showToast('🃏 Mazzo mescolato!');
    }
    function drawCard(shared) {
      if (deckCards.length === 0) { showToast('Mazzo esaurito!'); return; }
      const card = deckCards.pop();
      deckDrawn.push(card);
      renderDeckPanel();
      if (shared) {
        const txt = `🃏 Carta pescata: ${card}`;
        if (typeof addChatMessage === 'function') addChatMessage(window.myName||'GM', txt);
        if (typeof broadcast === 'function') broadcast({ type:'chat', sender: window.myName||'GM', text: txt });
      } else {
        showToast('🃏 Carta: ' + card + ' (privata)');
      }
    }
    function renderDeckPanel() {
      const div = $('deck-panel-content');
      if (!div) return;
      div.innerHTML = `<span class="chip">Rimanenti: ${deckCards.length}</span> <span class="chip">Pescate: ${deckDrawn.length}</span>`;
    }
    buildDeck();

    // ============================================================
    // FEATURE 9: TIMER
    // ============================================================
    let timerInterval = null;
    let timerRemaining = 0;
    let timerRunning = false;

    function timerBeep() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.start(); osc.stop(ctx.currentTime + 0.8);
      } catch(e) {}
    }

    function updateTimerDisplay() {
      const el = $('timer-display');
      if (!el) return;
      const m = Math.floor(timerRemaining / 60);
      const s = timerRemaining % 60;
      el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      el.style.color = timerRemaining <= 10 ? 'var(--accent-danger)' : 'var(--text-primary)';
    }

    window.startTimer = function() {
      if (timerRunning) return;
      if (timerRemaining <= 0) {
        const secs = parseInt($('timer-input')?.value || '60');
        timerRemaining = secs;
      }
      timerRunning = true;
      timerInterval = setInterval(() => {
        timerRemaining--;
        updateTimerDisplay();
        if (typeof broadcast === 'function') broadcast({ type: 'timer_tick', remaining: timerRemaining });
        if (timerRemaining <= 0) {
          clearInterval(timerInterval);
          timerRunning = false;
          timerBeep();
          showToast('⏱ Timer scaduto!');
          const label = $('timer-label-input')?.value || 'Timer';
          if (typeof addChatMessage === 'function') addChatMessage('⏱ Sistema', `⏱ ${label}: TEMPO SCADUTO!`);
          if (typeof broadcast === 'function') broadcast({ type:'chat', sender:'⏱ Sistema', text: `⏱ ${label}: TEMPO SCADUTO!` });
        }
      }, 1000);
    };

    window.pauseTimer = function() {
      clearInterval(timerInterval);
      timerRunning = false;
    };

    window.resetTimer = function() {
      clearInterval(timerInterval);
      timerRunning = false;
      timerRemaining = 0;
      updateTimerDisplay();
      if (typeof broadcast === 'function') broadcast({ type: 'timer_reset' });
    };

    registerFeatureDataHandler(d => {
      if (d.type === 'timer_tick') { timerRemaining = d.remaining; updateTimerDisplay(); }
      if (d.type === 'timer_reset') { timerRemaining = 0; updateTimerDisplay(); }
    });

    // ============================================================
    // FEATURE 8: MACRO
    // ============================================================
    let macros = JSON.parse(localStorage.getItem('vtt_macros') || '[]');

    function saveMacros() { localStorage.setItem('vtt_macros', JSON.stringify(macros)); }

    function execMacro(cmd) {
      if (!cmd) return;
      if (cmd.startsWith('/roll') || cmd.startsWith('/r ')) {
        const inp = $('chat-input');
        if (inp) { inp.value = cmd; window.sendChatMessage && window.sendChatMessage(); }
      } else if (cmd.startsWith('/msg ') || cmd.startsWith('/whisper ')) {
        const text = cmd.replace(/^\/(?:msg|whisper)\s+/, '');
        if (typeof addChatMessage === 'function') addChatMessage(window.myName||'?', text);
      } else {
        const inp = $('chat-input');
        if (inp) { inp.value = cmd; window.sendChatMessage && window.sendChatMessage(); }
      }
    }

    function renderMacros() {
      const list = $('macro-list');
      if (!list) return;
      list.innerHTML = '';
      macros.forEach((m, i) => {
        const row = el('div', 'encounter-item');
        row.innerHTML = `<span style="flex:1;font-size:.8rem">${m.name} <small style="color:var(--text-muted)">${m.key ? '[' + m.key + ']' : ''}</small></span>
          <button onclick="window.execMacro('${m.cmd.replace(/'/g,"\\'")}')">▶</button>
          <button onclick="window.macros.splice(${i},1);window.saveMacros&&window.saveMacros();window.renderMacros&&window.renderMacros()" style="color:var(--accent-danger)">✕</button>`;
        list.appendChild(row);
      });
    }
    window.macros = macros;
    window.saveMacros = saveMacros;
    window.renderMacros = renderMacros;
    window.execMacro = execMacro;

    // Hotkey F1-F10
    document.addEventListener('keydown', e => {
      const fKeys = ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10'];
      const fi = fKeys.indexOf(e.key);
      if (fi >= 0) {
        const m = macros.find(m => m.key === e.key);
        if (m) { e.preventDefault(); execMacro(m.cmd); }
      }
    });

    // ============================================================
    // FEATURE 6: JOURNAL
    // ============================================================
    let journal = JSON.parse(localStorage.getItem('vtt_journal') || '[]');
    function saveJournal() { localStorage.setItem('vtt_journal', JSON.stringify(journal)); }
    function renderJournal() {
      const list = $('journal-list');
      if (!list) return;
      list.innerHTML = '';
      journal.forEach((entry, i) => {
        const div = el('div', 'list-item');
        div.innerHTML = `<span class="name">${entry.shared ? '🌐' : '🔒'} ${entry.title}</span>
          <button onclick="window.sendHandout(${i})" title="Invia come handout" style="padding:2px 6px;font-size:.7rem">📤</button>
          <button onclick="window.journal.splice(${i},1);window.saveJournal();window.renderJournal()" style="padding:2px 6px;font-size:.7rem;color:var(--accent-danger)">✕</button>`;
        div.onclick = () => editJournalEntry(i);
        list.appendChild(div);
      });
    }
    function editJournalEntry(i) {
      const e = journal[i];
      $('journal-title-input').value = e.title;
      $('journal-body-input').value = e.body;
      $('journal-shared-check').checked = e.shared;
      $('journal-editing-idx').value = i;
    }
    window.journal = journal;
    window.saveJournal = saveJournal;
    window.renderJournal = renderJournal;
    window.sendHandout = function(i) {
      const e = journal[i];
      if (!e) return;
      const txt = `📜 HANDOUT — ${e.title}:\n${e.body}`;
      if (typeof addChatMessage === 'function') addChatMessage('📜 GM', txt);
      if (typeof broadcast === 'function') broadcast({ type:'chat', sender:'📜 GM', text: txt });
      showToast('Handout inviato!');
    };

    // ============================================================
    // FEATURE 5: RIGHELLO DI MISURAZIONE
    // ============================================================
    let rulerActive = false;
    let rulerStart = null;
    let rulerWaypoints = [];
    let rulerMode = 'euclidean';

    function getRulerCanvas() {
      let c = $('ruler-canvas');
      if (!c) {
        const area = $('canvas-area');
        c = document.createElement('canvas');
        c.id = 'ruler-canvas';
        c.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:15';
        c.width = area.clientWidth;
        c.height = area.clientHeight;
        area.appendChild(c);
      }
      return c;
    }

    function drawRulerLine(end) {
      const c = getRulerCanvas();
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      if (!rulerStart || !end) return;
      const pts = [rulerStart, ...rulerWaypoints, end];
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = 'rgba(251,191,36,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6,4]);
      ctx.stroke();
      // Distanza totale
      let dist = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i-1].x;
        const dy = pts[i].y - pts[i-1].y;
        dist += rulerMode === 'euclidean' ? Math.sqrt(dx*dx+dy*dy) : Math.abs(dx)+Math.abs(dy);
      }
      const CELL = 50; // pixel per cella
      const feet = Math.round(dist / CELL * 5);
      ctx.font = 'bold 14px system-ui';
      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.strokeText(feet + ' ft', end.x + 8, end.y - 8);
      ctx.fillText(feet + ' ft', end.x + 8, end.y - 8);
    }

    window.toggleRuler = function() {
      rulerActive = !rulerActive;
      rulerStart = null;
      rulerWaypoints = [];
      const btn = $('btn-ruler');
      if (btn) btn.classList.toggle('active', rulerActive);
      const c = $('ruler-canvas');
      if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
      showToast(rulerActive ? '📏 Righello attivo (M)' : '📏 Righello disattivato');
    };

    document.addEventListener('keydown', e => {
      if (e.key === 'm' || e.key === 'M') {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
        window.toggleRuler();
      }
    });

    const canvasArea = $('canvas-area');
    if (canvasArea) {
      canvasArea.addEventListener('mousemove', e => {
        if (!rulerActive || !rulerStart) return;
        const rect = canvasArea.getBoundingClientRect();
        drawRulerLine({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      });
      canvasArea.addEventListener('mousedown', e => {
        if (!rulerActive) return;
        const rect = canvasArea.getBoundingClientRect();
        const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        if (!rulerStart) {
          rulerStart = pt;
        } else if (e.shiftKey) {
          rulerWaypoints.push(pt);
        } else {
          rulerStart = null;
          rulerWaypoints = [];
          const c = $('ruler-canvas');
          if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
        }
        e.stopPropagation();
      });
    }

    // ============================================================
    // FEATURE 4: TEMPLATE AoE
    // ============================================================
    let aoeTemplates = [];
    let aoeActive = null; // { type: 'circle'|'cone'|'line', drawing: bool }
    let aoeStart = null;

    function getAoeCanvas() {
      let c = $('aoe-canvas');
      if (!c) {
        const area = $('canvas-area');
        c = document.createElement('canvas');
        c.id = 'aoe-canvas';
        c.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:12';
        c.width = area.clientWidth;
        c.height = area.clientHeight;
        area.appendChild(c);
      }
      return c;
    }

    function drawAllAoe(preview) {
      const c = getAoeCanvas();
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      const all = preview ? [...aoeTemplates, preview] : aoeTemplates;
      all.forEach(t => {
        ctx.fillStyle = 'rgba(239,68,68,0.25)';
        ctx.strokeStyle = 'rgba(239,68,68,0.8)';
        ctx.lineWidth = 2;
        if (t.type === 'circle') {
          const r = Math.sqrt((t.x2-t.x1)**2 + (t.y2-t.y1)**2);
          ctx.beginPath(); ctx.arc(t.x1, t.y1, r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
          const CELL=50, feet=Math.round(r/CELL*5);
          ctx.fillStyle='rgba(239,68,68,0.9)'; ctx.font='bold 12px system-ui';
          ctx.fillText(feet+'ft r', t.x1+r+4, t.y1);
        } else if (t.type === 'line') {
          const dx=t.x2-t.x1, dy=t.y2-t.y1;
          const len=Math.sqrt(dx*dx+dy*dy), nx=-dy/len*15, ny=dx/len*15;
          ctx.beginPath();
          ctx.moveTo(t.x1+nx,t.y1+ny); ctx.lineTo(t.x2+nx,t.y2+ny);
          ctx.lineTo(t.x2-nx,t.y2-ny); ctx.lineTo(t.x1-nx,t.y1-ny);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        } else if (t.type === 'cone') {
          const angle = Math.atan2(t.y2-t.y1, t.x2-t.x1);
          const len = Math.sqrt((t.x2-t.x1)**2+(t.y2-t.y1)**2);
          ctx.beginPath();
          ctx.moveTo(t.x1,t.y1);
          ctx.arc(t.x1,t.y1,len,angle-Math.PI/6,angle+Math.PI/6);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      });
    }

    window.activateAoe = function(type) {
      if (!window.isGM) { showToast('Solo il GM può usare i template AoE'); return; }
      aoeActive = type;
      const btns = document.querySelectorAll('.aoe-btn');
      btns.forEach(b => b.classList.toggle('active', b.dataset.aoe === type));
      showToast('AoE: ' + type + ' — trascina sulla mappa');
    };

    if (canvasArea) {
      canvasArea.addEventListener('mousedown', e => {
        if (!aoeActive || !window.isGM) return;
        const rect = canvasArea.getBoundingClientRect();
        aoeStart = { x: e.clientX-rect.left, y: e.clientY-rect.top };
        e.stopPropagation();
      }, true);
      canvasArea.addEventListener('mousemove', e => {
        if (!aoeActive || !aoeStart) return;
        const rect = canvasArea.getBoundingClientRect();
        const cur = { x: e.clientX-rect.left, y: e.clientY-rect.top };
        drawAllAoe({ type: aoeActive, x1: aoeStart.x, y1: aoeStart.y, x2: cur.x, y2: cur.y });
      });
      canvasArea.addEventListener('mouseup', e => {
        if (!aoeActive || !aoeStart || !window.isGM) return;
        const rect = canvasArea.getBoundingClientRect();
        const tmpl = { type: aoeActive, x1: aoeStart.x, y1: aoeStart.y, x2: e.clientX-rect.left, y2: e.clientY-rect.top, id: Date.now() };
        aoeTemplates.push(tmpl);
        aoeStart = null;
        drawAllAoe();
        if (typeof broadcast === 'function') broadcast({ type: 'aoe_update', templates: aoeTemplates });
      });
      // Click destro su canvas: rimuovi template AoE
      canvasArea.addEventListener('contextmenu', e => {
        if (aoeTemplates.length === 0 || !window.isGM) return;
        e.preventDefault();
        const rect = canvasArea.getBoundingClientRect();
        const mx = e.clientX-rect.left, my = e.clientY-rect.top;
        aoeTemplates = aoeTemplates.filter(t => {
          const dx=mx-t.x1, dy=my-t.y1;
          return Math.sqrt(dx*dx+dy*dy) > 30;
        });
        drawAllAoe();
        if (typeof broadcast === 'function') broadcast({ type: 'aoe_update', templates: aoeTemplates });
      });
    }

    registerFeatureDataHandler(d => {
      if (d.type === 'aoe_update') { aoeTemplates = d.templates; drawAllAoe(); }
    });

    // ============================================================
    // FEATURE 1: FOG OF WAR
    // ============================================================
    let fogActive = false;
    let fogBrush = 'reveal'; // 'reveal' | 'hide'
    let fogSize = 60;
    // fogMap = array di zone rivelate { x, y, r }
    let fogRevealed = [];
    let fogPainting = false;

    function getFogCanvas() {
      let c = $('fog-canvas');
      if (!c) {
        const area = $('canvas-area');
        c = document.createElement('canvas');
        c.id = 'fog-canvas';
        c.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:14';
        c.width = area.clientWidth;
        c.height = area.clientHeight;
        area.appendChild(c);
        drawFog();
      }
      return c;
    }

    function drawFog() {
      if (!fogActive) {
        const c = $('fog-canvas');
        if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
        return;
      }
      const c = getFogCanvas();
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      // Oscura tutto
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, 0, c.width, c.height);
      // Rivela zone
      fogRevealed.forEach(z => {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        const grad = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(0.8, 'rgba(0,0,0,0.9)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      });
    }

    window.toggleFog = function() {
      fogActive = !fogActive;
      const btn = $('btn-fog');
      if (btn) btn.classList.toggle('active', fogActive);
      if (!fogActive) {
        const c = $('fog-canvas');
        if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
      } else {
        getFogCanvas();
        drawFog();
      }
      if (typeof broadcast === 'function') broadcast({ type: 'fog_state', active: fogActive, revealed: fogRevealed });
    };

    window.resetFog = function() {
      fogRevealed = [];
      drawFog();
      if (typeof broadcast === 'function') broadcast({ type: 'fog_state', active: fogActive, revealed: fogRevealed });
      showToast('Fog of War resettata');
    };

    window.setFogBrush = function(type) {
      fogBrush = type;
      $('btn-fog-reveal')?.classList.toggle('active', type==='reveal');
      $('btn-fog-hide')?.classList.toggle('active', type==='hide');
    };

    // Pennello fog sul canvas (solo GM)
    if (canvasArea) {
      canvasArea.addEventListener('mousedown', e => {
        if (!fogActive || !window.isGM) return;
        const btn = $('btn-fog');
        if (!btn || !btn.classList.contains('active')) return;
        fogPainting = true;
        paintFog(e);
      });
      canvasArea.addEventListener('mousemove', e => {
        if (!fogPainting || !fogActive || !window.isGM) return;
        paintFog(e);
      });
      canvasArea.addEventListener('mouseup', () => {
        if (!fogPainting) return;
        fogPainting = false;
        if (typeof broadcast === 'function') broadcast({ type: 'fog_state', active: fogActive, revealed: fogRevealed });
      });
    }

    function paintFog(e) {
      const rect = canvasArea.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (fogBrush === 'reveal') {
        fogRevealed.push({ x, y, r: fogSize });
      } else {
        fogRevealed = fogRevealed.filter(z => Math.sqrt((z.x-x)**2+(z.y-y)**2) > fogSize*0.5);
      }
      drawFog();
    }

    registerFeatureDataHandler(d => {
      if (d.type === 'fog_state') {
        fogActive = d.active;
        fogRevealed = d.revealed || [];
        drawFog();
      }
    });

    // ============================================================
    // FEATURE 3: HP SUI TOKEN
    // ============================================================
    // Richiede che tokens siano oggetti con { id, x, y, name, img, hp, hpMax, hpVisible }
    // Questa feature estende il rendering dei token esistenti
    // (da integrare nel loop di draw del canvas esistente)
    window.initTokenHP = function(token) {
      if (!token.hp) token.hp = 20;
      if (!token.hpMax) token.hpMax = 20;
      if (token.hpVisible === undefined) token.hpVisible = true;
    };

    // Funzione per disegnare la barra HP sopra un token
    window.drawTokenHP = function(ctx, token, x, y, size) {
      if (!window.isGM && !token.hpVisible) return;
      const w = size || 40;
      const barW = w;
      const barH = 6;
      const bx = x - barW/2;
      const by = y - (size||40)/2 - 10;
      const pct = Math.max(0, Math.min(1, (token.hp||0) / (token.hpMax||1)));
      const color = pct > 0.5 ? '#10b981' : pct > 0.25 ? '#f59e0b' : '#ef4444';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = color;
      ctx.fillRect(bx, by, barW * pct, barH);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, barW, barH);
    };

    // Popover HP su click destro del token
    window.showHPPopover = function(token, screenX, screenY) {
      if (!window.isGM) return;
      let pop = $('hp-popover');
      if (pop) pop.remove();
      pop = el('div', '', '');
      pop.id = 'hp-popover';
      pop.style.cssText = `position:fixed;z-index:600;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px;box-shadow:var(--shadow);min-width:180px;left:${screenX}px;top:${screenY}px`;
      pop.innerHTML = `
        <div style="font-weight:600;margin-bottom:8px">${token.name} — HP</div>
        <label style="font-size:.8rem">HP correnti: <input type="number" id="hp-cur" value="${token.hp||20}" style="width:70px"></label><br><br>
        <label style="font-size:.8rem">HP massimi: <input type="number" id="hp-max" value="${token.hpMax||20}" style="width:70px"></label><br><br>
        <label style="font-size:.8rem"><input type="checkbox" id="hp-vis" ${token.hpVisible!==false?'checked':''}> Visibile ai player</label><br><br>
        <div style="display:flex;gap:6px">
          <button onclick="window._applyHP('${token.id}')">✓ Salva</button>
          <button onclick="document.getElementById('hp-popover').remove()">✕</button>
        </div>`;
      document.body.appendChild(pop);
      setTimeout(() => document.addEventListener('click', e => {
        if (!pop.contains(e.target)) { pop.remove(); }
      }, { once: true }), 100);
    };

    window._applyHP = function(tokenId) {
      if (!window.tokens) return;
      const t = window.tokens.find(t => t.id === tokenId);
      if (!t) return;
      t.hp = parseInt($('hp-cur')?.value || '20');
      t.hpMax = parseInt($('hp-max')?.value || '20');
      t.hpVisible = $('hp-vis')?.checked !== false;
      $('hp-popover')?.remove();
      if (window.renderCanvas) window.renderCanvas();
      if (typeof broadcast === 'function') broadcast({ type: 'token_hp_update', tokenId, hp: t.hp, hpMax: t.hpMax, hpVisible: t.hpVisible });
      showToast('HP aggiornati');
    };

    registerFeatureDataHandler(d => {
      if (d.type === 'token_hp_update' && window.tokens) {
        const t = window.tokens.find(t => t.id === d.tokenId);
        if (t) { t.hp = d.hp; t.hpMax = d.hpMax; t.hpVisible = d.hpVisible; }
        if (window.renderCanvas) window.renderCanvas();
      }
    });

    // ============================================================
    // COSTRUZIONE UI — INIETTA PANNELLI
    // ============================================================
    function injectUI() {
      // ---- TAB JOURNAL nel pannello SINISTRO ----
      const leftTabs = document.querySelector('#left-panel .panel-tabs');
      const leftBody = $('left-panel-body');
      if (leftTabs && !$('tab-journal')) {
        const btn = el('button', '', '📖 Journal');
        btn.dataset.tab = 'journal';
        btn.id = 'tab-journal';
        leftTabs.appendChild(btn);

        const journalPanel = el('div', 'panel-body', '');
        journalPanel.id = 'journal-panel';
        journalPanel.style.display = 'none';
        journalPanel.innerHTML = `
          <div class="list-header"><span>Journal</span></div>
          <div id="journal-list"></div>
          <hr style="border-color:var(--border);margin:8px 0">
          <input type="text" id="journal-title-input" placeholder="Titolo voce" style="width:100%;margin-bottom:6px">
          <textarea id="journal-body-input" placeholder="Testo..." rows="4" style="width:100%;resize:vertical"></textarea>
          <label style="font-size:.8rem;display:flex;align-items:center;gap:4px;margin:6px 0"><input type="checkbox" id="journal-shared-check"> Condividi con tutti</label>
          <input type="hidden" id="journal-editing-idx" value="-1">
          <div style="display:flex;gap:6px">
            <button onclick="window._saveJournalEntry()" class="primary" style="flex:1">+ Salva voce</button>
          </div>`;
        leftBody.parentElement.insertBefore(journalPanel, leftBody.nextSibling);

        // Rimappa tab sinistro
        leftTabs.querySelectorAll('button').forEach(b => {
          b.addEventListener('click', () => {
            leftTabs.querySelectorAll('button').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            leftBody.style.display = b.dataset.tab !== 'journal' ? '' : 'none';
            if ($('journal-panel')) $('journal-panel').style.display = b.dataset.tab === 'journal' ? '' : 'none';
          });
        });
      }

      window._saveJournalEntry = function() {
        const title = $('journal-title-input')?.value.trim();
        const body = $('journal-body-input')?.value.trim();
        const shared = $('journal-shared-check')?.checked;
        if (!title) { showToast('Inserisci un titolo'); return; }
        const idx = parseInt($('journal-editing-idx')?.value || '-1');
        if (idx >= 0 && journal[idx]) {
          journal[idx] = { title, body, shared };
        } else {
          journal.push({ title, body, shared });
        }
        saveJournal();
        renderJournal();
        if ($('journal-title-input')) $('journal-title-input').value = '';
        if ($('journal-body-input')) $('journal-body-input').value = '';
        if ($('journal-editing-idx')) $('journal-editing-idx').value = '-1';
        showToast('Voce salvata');
      };

      // ---- TOOLS PANEL: nuove sezioni ----
      const toolsPanel = $('tools-panel');
      if (toolsPanel && !$('deck-tools-card')) {

        // Fog of War card (solo GM)
        if (window.isGM) {
          const fogCard = el('div', 'tools-card', '');
          fogCard.innerHTML = `
            <h4>🌫️ Fog of War</h4>
            <div class="tools-row">
              <button id="btn-fog" onclick="window.toggleFog()">Toggle Fog</button>
              <button id="btn-fog-reveal" class="active" onclick="window.setFogBrush('reveal')">✏️ Rivela</button>
              <button id="btn-fog-hide" onclick="window.setFogBrush('hide')">⬛ Oscura</button>
            </div>
            <div class="tools-row">
              <label style="font-size:.8rem">Pennello: <input type="range" id="fog-size" min="20" max="150" value="60" style="width:100px" oninput="fogSize=this.value" title="Dimensione pennello"></label>
              <button onclick="window.resetFog()">Reset</button>
            </div>`;
          toolsPanel.insertBefore(fogCard, toolsPanel.firstChild);
        }

        // AoE card (solo GM)
        if (window.isGM) {
          const aoeCard = el('div', 'tools-card', '');
          aoeCard.innerHTML = `
            <h4>💥 Template AoE</h4>
            <div class="tools-row">
              <button class="aoe-btn" data-aoe="circle" onclick="window.activateAoe('circle')">⭕ Cerchio</button>
              <button class="aoe-btn" data-aoe="cone" onclick="window.activateAoe('cone')">🔺 Cono</button>
              <button class="aoe-btn" data-aoe="line" onclick="window.activateAoe('line')">📏 Linea</button>
            </div>
            <div style="font-size:.75rem;color:var(--text-muted)">Trascina sulla mappa. Clic destro per rimuovere.</div>`;
          toolsPanel.insertBefore(aoeCard, toolsPanel.firstChild);
        }

        // Righello card
        const rulerCard = el('div', 'tools-card', '');
        rulerCard.innerHTML = `
          <h4>📏 Righello</h4>
          <div class="tools-row">
            <button id="btn-ruler" onclick="window.toggleRuler()">📏 Misura (M)</button>
            <select id="ruler-mode-sel" onchange="rulerMode=this.value" style="background:var(--bg-darker);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:4px">
              <option value="euclidean">Euclidea</option>
              <option value="manhattan">Manhattan</option>
            </select>
          </div>
          <div style="font-size:.75rem;color:var(--text-muted)">Shift+click per waypoint. Click per resettare.</div>`;
        toolsPanel.insertBefore(rulerCard, toolsPanel.firstChild);

        // Deck card
        const deckCard = el('div', 'tools-card', '');
        deckCard.id = 'deck-tools-card';
        deckCard.innerHTML = `
          <h4>🃏 Deck</h4>
          <div id="deck-panel-content" style="margin-bottom:6px"></div>
          <div class="tools-row">
            <button onclick="shuffleDeck()">🔀 Shuffle</button>
            <button onclick="drawCard(true)">🂠 Pesca (pubblica)</button>
            <button onclick="drawCard(false)">🔒 Pesca (privata)</button>
          </div>
          <div class="tools-row">
            <button onclick="buildDeck();renderDeckPanel();showToast('Mazzo rimescolato')">↩ Rimetti tutto</button>
          </div>`;
        toolsPanel.appendChild(deckCard);

        // Timer card
        const timerCard = el('div', 'tools-card', '');
        timerCard.innerHTML = `
          <h4>⏱ Timer</h4>
          <div class="tools-row">
            <input type="text" id="timer-label-input" placeholder="Label (es: Rituale)" style="flex:1">
            <input type="number" id="timer-input" placeholder="Sec" value="60" style="max-width:70px">
          </div>
          <div style="font-size:2rem;text-align:center;font-weight:700;letter-spacing:2px;margin:4px 0" id="timer-display">01:00</div>
          <div class="tools-row">
            <button onclick="window.startTimer()" class="primary">▶ Start</button>
            <button onclick="window.pauseTimer()">⏸ Pausa</button>
            <button onclick="window.resetTimer()">⏹ Reset</button>
          </div>`;
        toolsPanel.appendChild(timerCard);

        // Macro card
        const macroCard = el('div', 'tools-card', '');
        macroCard.innerHTML = `
          <h4>⚡ Macro</h4>
          <div class="tools-row">
            <input type="text" id="macro-name-input" placeholder="Nome macro" style="flex:1">
            <select id="macro-key-sel" style="background:var(--bg-darker);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:4px">
              <option value="">Nessun tasto</option>
              ${[1,2,3,4,5,6,7,8,9,10].map(i=>`<option value="F${i}">F${i}</option>`).join('')}
            </select>
          </div>
          <div class="tools-row">
            <input type="text" id="macro-cmd-input" placeholder="/roll 1d20+5 o testo" style="flex:1">
            <button onclick="window._addMacro()">+ Add</button>
          </div>
          <div id="macro-list"></div>`;
        toolsPanel.appendChild(macroCard);
      }

      // Toolbar: pulsante righello e fog (solo GM)
      const toolbar = $('toolbar');
      if (toolbar && !$('btn-ruler-toolbar') && window.isGM) {
        const rBtn = el('button', '', '📏');
        rBtn.id = 'btn-ruler-toolbar';
        rBtn.title = 'Righello (M)';
        rBtn.onclick = window.toggleRuler;
        toolbar.appendChild(rBtn);
      }

      renderJournal();
      renderDeckPanel();
      renderMacros();
      injectSystemDropdown();
    }

    window._addMacro = function() {
      const name = $('macro-name-input')?.value.trim();
      const cmd = $('macro-cmd-input')?.value.trim();
      const key = $('macro-key-sel')?.value || '';
      if (!name || !cmd) { showToast('Inserisci nome e comando'); return; }
      macros.push({ name, cmd, key });
      saveMacros();
      renderMacros();
      if ($('macro-name-input')) $('macro-name-input').value = '';
      if ($('macro-cmd-input')) $('macro-cmd-input').value = '';
      showToast('Macro aggiunta');
    };

    // Aspetta che il GM entri nell'app
    const appEl = $('app');
    const appObserver = new MutationObserver(() => {
      if (appEl.classList.contains('show')) {
        appObserver.disconnect();
        setTimeout(injectUI, 400);
      }
    });
    appObserver.observe(appEl, { attributes: true, attributeFilter: ['class'] });
    // Se già aperta
    if (appEl.classList.contains('show')) setTimeout(injectUI, 400);

    // Patch handler dati P2P — esegui feature handlers
    // Ogni volta che arriva un messaggio dal peer, passa anche a feature handlers
    // Questo va fatto DOPO che peer è pronto
    const _watchPeer = setInterval(() => {
      if (!window.peer) return;
      clearInterval(_watchPeer);
      const origOn = window.peer.on?.bind(window.peer);
      // Non possiamo facilmente intercettare i conn handler già registrati;
      // usiamo invece un approccio alternativo: override di handleIncomingData globale
      // se definita, altrimenti polling
      if (typeof window.handleIncomingData === 'function') {
        const _orig = window.handleIncomingData;
        window.handleIncomingData = function(data) {
          _orig(data);
          window.handleFeatureData(data);
        };
      }
    }, 500);

    console.log('[OpenVTT Features] 10 feature caricate.');
  });
})();
