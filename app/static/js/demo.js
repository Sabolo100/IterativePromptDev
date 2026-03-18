// === STATE ===
let currentSessionId = null;
let currentMode = 'auto';
let eventSource = null;
let scores = [];
let presets = [];
let iterationData = {};

// Domain icons by domain_en keyword
const DOMAIN_ICONS = {
    marketing: '📣', sales: '💼', software: '💻', programming: '🖥️',
    finance: '📊', legal: '⚖️', medical: '🏥', tourism: '✈️',
    gastronomy: '🍴', education: '🎓', hr: '👥', real_estate: '🏠',
    logistics: '🚚', literature: '📚', creative: '✍️', science: '🔬',
    engineering: '⚙️', architecture: '🏛️', psychology: '🧠', sports: '🏆',
    music: '🎵', art: '🎨', fashion: '👗', environment: '🌿',
    default: '🤖'
};

function getDomainIcon(domain_en) {
    if (!domain_en) return DOMAIN_ICONS.default;
    const lower = domain_en.toLowerCase();
    for (const [key, icon] of Object.entries(DOMAIN_ICONS)) {
        if (lower.includes(key)) return icon;
    }
    return DOMAIN_ICONS.default;
}

// === INIT ===
document.addEventListener('DOMContentLoaded', async () => {
    await loadModels();
    await loadPresets();
});

async function loadModels() {
    const res = await fetch('/api/models');
    const models = await res.json();

    const selectors = ['generatorModel', 'evaluatorModel', 'refinerModel'];
    const defaults = {
        generatorModel: 'openai:gpt-4.1',
        evaluatorModel: 'openai:gpt-4.1-mini',
        refinerModel: 'openai:gpt-4.1-mini',
    };

    selectors.forEach(selId => {
        const sel = document.getElementById(selId);
        sel.innerHTML = '';
        for (const [provKey, prov] of Object.entries(models)) {
            const group = document.createElement('optgroup');
            group.label = prov.name + (prov.configured ? '' : ' (nincs API kulcs)');
            prov.models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = `${provKey}:${m}`;
                opt.textContent = m;
                if (!prov.configured) opt.disabled = true;
                if (opt.value === defaults[selId]) opt.selected = true;
                group.appendChild(opt);
            });
            sel.appendChild(group);
        }
    });
}

async function loadPresets() {
    const res = await fetch('/api/presets');
    presets = await res.json();
    const row = document.getElementById('presetsRow');
    presets.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.dataset.preset = p.preset_id;
        btn.textContent = p.name;
        btn.onclick = () => selectPreset(p.preset_id);
        btn.title = p.description || '';
        row.appendChild(btn);
    });
}

function selectPreset(presetId) {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b.dataset.preset === presetId));
    if (presetId !== 'custom') {
        const preset = presets.find(p => p.preset_id === presetId);
        if (preset) document.getElementById('userPrompt').value = preset.user_prompt;
    }
}

function setMode(mode) {
    currentMode = mode;
    document.getElementById('modeAuto').classList.toggle('active', mode === 'auto');
    document.getElementById('modeManual').classList.toggle('active', mode === 'manual');
    updateControlButtons();
}

function updateControlButtons() {
    const status = document.getElementById('sessionStatus').textContent;
    const isIdle = !currentSessionId;
    const isPaused = status === 'paused';
    const isRunning = status === 'running' || status === 'detecting';
    const isDone = status === 'done' || status === 'stopped';

    document.getElementById('btnStart').classList.toggle('hidden', !isIdle);
    document.getElementById('btnPause').classList.toggle('hidden', !isRunning || currentMode !== 'auto');
    document.getElementById('btnResume').classList.toggle('hidden', !isPaused || currentMode !== 'auto');
    document.getElementById('btnStep').classList.toggle('hidden',
        !(isPaused && currentMode === 'manual') && !(currentSessionId && currentMode === 'manual' && !isRunning && !isDone));
    document.getElementById('btnStop').classList.toggle('hidden', isIdle || isDone);
}

// === SESSION CONTROL ===
async function startSession() {
    const userPrompt = document.getElementById('userPrompt').value.trim();
    if (!userPrompt) {
        alert('Kérlek adj meg egy promptot vagy válassz egy presetet!');
        return;
    }

    const activePreset = document.querySelector('.preset-btn.active');
    const presetId = activePreset ? activePreset.dataset.preset : 'custom';

    const body = {
        preset_id: presetId !== 'custom' ? presetId : undefined,
        mode: currentMode,
        generator_model: document.getElementById('generatorModel').value,
        evaluator_model: document.getElementById('evaluatorModel').value,
        refiner_model: document.getElementById('refinerModel').value,
        user_prompt: userPrompt,
        max_iterations: parseInt(document.getElementById('maxIterations').value) || 5,
    };

    const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    const data = await res.json();
    currentSessionId = data.session_id;

    // Reset UI
    scores = [];
    iterationData = {};
    document.getElementById('iterationsCanvas').innerHTML = '';
    document.getElementById('summaryPanel').classList.add('hidden');
    document.getElementById('chartContainer').classList.remove('hidden');
    document.getElementById('sessionInfo').classList.remove('hidden');
    document.getElementById('sessionId').textContent = currentSessionId;
    document.getElementById('iterMax').textContent = body.max_iterations;

    // Show domain detection panel (detecting state)
    showDomainDetecting();

    drawChart();
    connectSSE();

    if (currentMode === 'auto') {
        await fetch(`/api/sessions/${currentSessionId}/start`, { method: 'POST' });
        setStatus('detecting');
    } else {
        // Manual mode: domain detection runs when Start is pressed
        await fetch(`/api/sessions/${currentSessionId}/start`, { method: 'POST' });
        setStatus('detecting');
    }
}

async function pauseSession() {
    if (!currentSessionId) return;
    await fetch(`/api/sessions/${currentSessionId}/pause`, { method: 'POST' });
    setStatus('paused');
}

async function resumeSession() {
    if (!currentSessionId) return;
    await fetch(`/api/sessions/${currentSessionId}/resume`, { method: 'POST' });
    setStatus('running');
}

async function stepSession() {
    if (!currentSessionId) return;
    await fetch(`/api/sessions/${currentSessionId}/step`, { method: 'POST' });
    setStatus('running');
}

async function stopSession() {
    if (!currentSessionId) return;
    await fetch(`/api/sessions/${currentSessionId}/stop`, { method: 'POST' });
    setStatus('stopped');
    showSummary();
}

function exportSession() {
    if (!currentSessionId) return;
    window.open(`/api/sessions/${currentSessionId}/export`, '_blank');
}

function resetDemo() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    currentSessionId = null;
    scores = [];
    iterationData = {};
    document.getElementById('iterationsCanvas').innerHTML = '';
    document.getElementById('summaryPanel').classList.add('hidden');
    document.getElementById('chartContainer').classList.add('hidden');
    document.getElementById('sessionInfo').classList.add('hidden');
    document.getElementById('domainPanel').classList.add('hidden');
    document.getElementById('iterCount').textContent = '0';
    setStatus('-');
    updateControlButtons();
}

function setStatus(status) {
    document.getElementById('sessionStatus').textContent = status;
    updateControlButtons();
}

// === DOMAIN PANEL ===
function showDomainDetecting() {
    const panel = document.getElementById('domainPanel');
    const card = document.getElementById('domainCard');
    panel.classList.remove('hidden');
    card.className = 'domain-card detecting';
    document.getElementById('domainDetecting').classList.remove('hidden');
    document.getElementById('domainDetected').classList.add('hidden');
    document.getElementById('domainBadge').classList.add('hidden');
    document.getElementById('domainIcon').textContent = '🔍';
}

function showDomainDetected(data) {
    const card = document.getElementById('domainCard');
    card.className = 'domain-card detected';

    document.getElementById('domainDetecting').classList.add('hidden');
    document.getElementById('domainDetected').classList.remove('hidden');

    // Icon
    document.getElementById('domainIcon').textContent = getDomainIcon(data.domain_en);

    // Expert info
    document.getElementById('expertTitle').textContent = data.expert_title || '';
    document.getElementById('expertDesc').textContent = data.expert_description || '';

    // Criteria tags
    const criteriaEl = document.getElementById('domainCriteria');
    criteriaEl.innerHTML = '';
    (data.evaluation_criteria || []).forEach(c => {
        const tag = document.createElement('span');
        tag.className = 'criterion-tag';
        tag.textContent = c;
        criteriaEl.appendChild(tag);
    });

    // Generated prompt preview
    document.getElementById('generatedEvalPrompt').textContent =
        data.evaluator_prompt_preview || '(Nem érhető el előnézet)';

    // Badge
    const badge = document.getElementById('domainBadge');
    badge.textContent = data.domain || 'Általános';
    badge.classList.remove('hidden');
}

// === SSE ===
function connectSSE() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/stream/${currentSessionId}`);
    eventSource.onmessage = (e) => {
        try {
            const event = JSON.parse(e.data);
            handleEvent(event);
        } catch (err) {
            console.error('SSE parse error', err);
        }
    };
}

function handleEvent(event) {
    const { type, data } = event;
    switch (type) {
        case 'domain_detecting':
            setStatus('detecting');
            break;
        case 'domain_detected':
            if (data.success) {
                showDomainDetected(data);
                setStatus('running');
            } else {
                // Domain detection failed — show warning but continue
                document.getElementById('domainDetecting').innerHTML =
                    `<span style="color:var(--orange)">⚠ ${data.message}</span>`;
                setStatus('running');
            }
            break;
        case 'status_change':
            handleStatusChange(data);
            break;
        case 'iteration_complete':
            handleIterationComplete(data);
            break;
        case 'session_complete':
            handleSessionComplete(data);
            break;
        case 'session_paused':
            setStatus('paused');
            break;
        case 'error':
            handleError(data);
            break;
    }
}

function handleStatusChange(data) {
    const { iteration_num, status, prompt_text, output_text, evaluation, overall_score } = data;
    document.getElementById('iterCount').textContent = iteration_num;
    ensureIterationBlock(iteration_num);

    if (status === 'generating') {
        updatePanel(iteration_num, 'prompt', prompt_text, 'generating');
        updatePanel(iteration_num, 'output', '', 'generating');
        updatePanel(iteration_num, 'eval', '', 'pending');
    } else if (status === 'evaluating') {
        updatePanel(iteration_num, 'output', output_text, 'done');
        updatePanel(iteration_num, 'eval', '', 'evaluating');
        if (data.generator_ms) setTimeBadge(iteration_num, 'output', data.generator_ms);
    } else if (status === 'refining') {
        renderEvaluation(iteration_num, evaluation, overall_score);
        updatePanelStatus(iteration_num, 'eval', 'done');
        if (data.evaluator_ms) setTimeBadge(iteration_num, 'eval', data.evaluator_ms);
    }
}

function handleIterationComplete(data) {
    const { iteration_num, prompt_text, output_text, evaluation, overall_score, refined_prompt } = data;
    iterationData[iteration_num] = data;
    scores.push(overall_score);
    drawChart();

    updatePanel(iteration_num, 'prompt', prompt_text, 'done');
    updatePanel(iteration_num, 'output', output_text, 'done');
    renderEvaluation(iteration_num, evaluation, overall_score);
    updatePanelStatus(iteration_num, 'eval', 'done');

    if (data.generator_ms) setTimeBadge(iteration_num, 'output', data.generator_ms);
    if (data.evaluator_ms) setTimeBadge(iteration_num, 'eval', data.evaluator_ms);
    if (data.refiner_ms) setTimeBadge(iteration_num, 'prompt', data.refiner_ms);

    if (currentMode === 'manual') setStatus('paused');
}

function handleSessionComplete(data) {
    setStatus('done');
    if (eventSource) { eventSource.close(); eventSource = null; }
    showSummary(data);
}

function handleError(data) {
    const { iteration_num, message } = data;
    if (iteration_num) {
        const block = document.getElementById(`iter-${iteration_num}`);
        if (block) {
            const errDiv = document.createElement('div');
            errDiv.style.cssText = 'grid-column:1/-1;color:var(--red);padding:8px;font-size:12px;background:rgba(255,82,82,0.08);border-radius:6px;';
            errDiv.textContent = `Hiba: ${message}`;
            block.appendChild(errDiv);
        }
    }
}

// === UI RENDERING ===
function ensureIterationBlock(num) {
    if (document.getElementById(`iter-${num}`)) return;
    const canvas = document.getElementById('iterationsCanvas');

    if (num > 1) {
        const conn = document.createElement('div');
        conn.className = 'connector-line';
        canvas.appendChild(conn);
    }

    const block = document.createElement('div');
    block.className = 'iteration-block';
    block.id = `iter-${num}`;
    block.innerHTML = `
        <div class="iteration-header">
            <div class="iteration-num">${num}</div>
            <div class="iteration-label">${num}. iteráció</div>
        </div>
        <div class="panel" id="panel-${num}-prompt">
            <div class="panel-header">
                <span class="panel-title prompt">Prompt</span>
                <span class="status-badge status-pending" id="status-${num}-prompt">
                    <span class="status-dot"></span><span>Várakozás</span>
                </span>
            </div>
            <div class="panel-body" id="body-${num}-prompt">...</div>
        </div>
        <div class="panel" id="panel-${num}-output">
            <div class="panel-header">
                <span class="panel-title output">Generált kimenet</span>
                <span class="status-badge status-pending" id="status-${num}-output">
                    <span class="status-dot"></span><span>Várakozás</span>
                </span>
            </div>
            <div class="panel-body" id="body-${num}-output">...</div>
        </div>
        <div class="panel" id="panel-${num}-eval">
            <div class="panel-header">
                <span class="panel-title evaluation">Értékelés</span>
                <span class="status-badge status-pending" id="status-${num}-eval">
                    <span class="status-dot"></span><span>Várakozás</span>
                </span>
            </div>
            <div class="panel-body" id="body-${num}-eval">...</div>
        </div>
    `;
    canvas.appendChild(block);
    block.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updatePanel(num, panelType, content, status) {
    const body = document.getElementById(`body-${num}-${panelType}`);
    if (body && content) body.textContent = content;
    updatePanelStatus(num, panelType, status);
    const panel = document.getElementById(`panel-${num}-${panelType}`);
    if (panel) panel.classList.toggle('active', status !== 'done' && status !== 'pending');
}

function updatePanelStatus(num, panelType, status) {
    const badge = document.getElementById(`status-${num}-${panelType}`);
    if (!badge) return;
    const labels = {
        pending: 'Várakozás', generating: 'Generálás...', evaluating: 'Értékelés...',
        refining: 'Finomítás...', done: 'Kész'
    };
    badge.className = `status-badge status-${status}`;
    badge.innerHTML = `<span class="status-dot"></span><span>${labels[status] || status}</span>`;
    const panel = document.getElementById(`panel-${num}-${panelType}`);
    if (panel && status === 'done') panel.classList.remove('active');
}

function setTimeBadge(num, panelType, ms) {
    const header = document.querySelector(`#panel-${num}-${panelType} .panel-header`);
    if (!header) return;
    let badge = header.querySelector('.time-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'time-badge';
        badge.style.cssText = 'font-size:10px;color:var(--text-dim);font-family:var(--font-mono);';
        header.appendChild(badge);
    }
    badge.textContent = ms > 1000 ? `${(ms/1000).toFixed(1)}s` : `${ms}ms`;
}

function renderEvaluation(num, evaluation, overallScore) {
    const body = document.getElementById(`body-${num}-eval`);
    if (!body || !evaluation) return;

    const scoreColor = (v) => v >= 7 ? 'var(--green)' : v >= 5 ? 'var(--orange)' : 'var(--red)';
    const overallColor = scoreColor(overallScore);

    // Show expert attribution if available
    let expertHtml = '';
    if (evaluation._expert_title) {
        expertHtml = `<div style="font-size:10px;color:var(--purple);font-family:var(--font-sans);margin-bottom:6px;font-weight:600;">
            🎓 ${evaluation._expert_title}${evaluation._domain ? ' · ' + evaluation._domain : ''}
        </div>`;
    }

    let html = expertHtml;
    html += `<div class="overall-score" style="color:${overallColor}">${overallScore.toFixed(1)}<span style="font-size:14px;color:var(--text-dim)">/10</span></div>`;

    if (evaluation.scores) {
        html += '<div class="scores-grid">';
        for (const [key, val] of Object.entries(evaluation.scores)) {
            const color = scoreColor(val);
            html += `<div class="score-item">
                <span class="score-label">${key}</span>
                <div class="score-bar"><div class="score-bar-fill" style="width:${val*10}%;background:${color}"></div></div>
                <span class="score-value" style="color:${color}">${val}</span>
            </div>`;
        }
        html += '</div>';
    }

    if (evaluation.feedback) {
        html += `<div class="feedback-text">${evaluation.feedback}</div>`;
    }
    if (evaluation.strengths && evaluation.strengths.length) {
        html += `<div class="feedback-section"><strong style="color:var(--green)">Erősségek</strong>
            <div class="feedback-text">${evaluation.strengths.map(s => '+ ' + s).join('<br>')}</div></div>`;
    }
    if (evaluation.weaknesses && evaluation.weaknesses.length) {
        html += `<div class="feedback-section"><strong style="color:var(--orange)">Gyengeségek</strong>
            <div class="feedback-text">${evaluation.weaknesses.map(s => '- ' + s).join('<br>')}</div></div>`;
    }

    body.innerHTML = html;
    body.style.fontFamily = 'var(--font-sans)';
}

// === CHART ===
function drawChart() {
    const canvas = document.getElementById('scoreChart');
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (scores.length === 0) {
        ctx.fillStyle = '#8888a0';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('A pontszámok itt jelennek meg...', w/2, h/2);
        return;
    }

    const pad = { top: 20, right: 30, bottom: 30, left: 40 };
    const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;

    // Grid
    ctx.strokeStyle = '#1e1e32'; ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i += 2) {
        const y = pad.top + ch - (i / 10) * ch;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
        ctx.fillStyle = '#8888a0'; ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'right'; ctx.fillText(i.toString(), pad.left - 8, y + 4);
    }

    scores.forEach((_, i) => {
        const x = pad.left + (scores.length === 1 ? cw/2 : (i/(scores.length-1))*cw);
        ctx.fillStyle = '#8888a0'; ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'center'; ctx.fillText(`#${i+1}`, x, h - 8);
    });

    if (scores.length < 2) {
        const x = pad.left + cw/2, y = pad.top + ch - (scores[0]/10)*ch;
        ctx.fillStyle = '#00d4ff'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2); ctx.fill();
        return;
    }

    // Line
    ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    scores.forEach((s, i) => {
        const x = pad.left + (i/(scores.length-1))*cw, y = pad.top + ch - (s/10)*ch;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill
    const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
    grad.addColorStop(0, 'rgba(0,212,255,0.2)'); grad.addColorStop(1, 'rgba(0,212,255,0)');
    ctx.fillStyle = grad; ctx.beginPath();
    scores.forEach((s, i) => {
        const x = pad.left + (i/(scores.length-1))*cw, y = pad.top + ch - (s/10)*ch;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.left + cw, pad.top + ch); ctx.lineTo(pad.left, pad.top + ch);
    ctx.closePath(); ctx.fill();

    // Points + labels
    scores.forEach((s, i) => {
        const x = pad.left + (i/(scores.length-1))*cw, y = pad.top + ch - (s/10)*ch;
        ctx.fillStyle = '#0a0a0f'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#00d4ff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#e0e0e8'; ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.textAlign = 'center'; ctx.fillText(s.toFixed(1), x, y - 10);
    });
}

// === SUMMARY ===
function showSummary(data) {
    const panel = document.getElementById('summaryPanel');
    const stats = document.getElementById('summaryStats');
    const totalIter = scores.length;
    const firstScore = scores[0] || 0, lastScore = scores[scores.length-1] || 0;
    const improvement = lastScore - firstScore;

    stats.innerHTML = `
        <div class="stat-box">
            <div class="stat-value" style="color:var(--accent)">${totalIter}</div>
            <div class="stat-label">Iteráció</div>
        </div>
        <div class="stat-box">
            <div class="stat-value" style="color:var(--green)">${lastScore.toFixed(1)}</div>
            <div class="stat-label">Végső pontszám</div>
        </div>
        <div class="stat-box">
            <div class="stat-value" style="color:${improvement >= 0 ? 'var(--green)' : 'var(--red)'}">
                ${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)}
            </div>
            <div class="stat-label">Javulás</div>
        </div>
        <div class="stat-box">
            <div class="stat-value">${firstScore.toFixed(1)}</div>
            <div class="stat-label">Induló pontszám</div>
        </div>
    `;
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth' });
}

// === WORD EXPORT ===
async function exportSessionDocx() {
    if (!currentSessionId) return;
    const btn = document.getElementById('btnDocxExport');
    const original = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Generálás...';
    btn.disabled = true;
    try {
        const res = await fetch(`/api/sessions/${currentSessionId}/export/docx`);
        if (!res.ok) {
            const err = await res.json();
            alert('Hiba: ' + (err.error || 'ismeretlen hiba'));
            return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session_${currentSessionId}.docx`;
        a.click();
        URL.revokeObjectURL(url);
    } catch(e) {
        alert('Word export hiba: ' + e.message);
    } finally {
        btn.innerHTML = original;
        btn.disabled = false;
    }
}
