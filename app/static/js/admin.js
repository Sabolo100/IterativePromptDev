document.addEventListener('DOMContentLoaded', () => {
    loadModelStatus();
    loadPrompts();
    loadAdminPresets();
    loadAdminSessions();
});

function showTab(name) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById(`tab-${name}`).classList.add('active');
}

async function loadModelStatus() {
    const res = await fetch('/api/models');
    const models = await res.json();
    const container = document.getElementById('modelsList');
    let html = '';
    for (const [key, info] of Object.entries(models)) {
        html += `
            <div class="model-status">
                <span class="api-dot ${info.configured ? 'ok' : 'missing'}"></span>
                <strong style="min-width:160px;">${info.name}</strong>
                <span style="color:var(--text-dim);font-size:12px;flex:1;">${info.models.join(', ')}</span>
                <span style="font-size:11px;color:${info.configured ? 'var(--green)' : 'var(--red)'}">
                    ${info.configured ? '✓ Konfigurálva' : '✗ Nincs API kulcs'}
                </span>
            </div>`;
    }
    container.innerHTML = html;
}

async function loadPrompts() {
    const res = await fetch('/api/config/prompts');
    const data = await res.json();
    document.getElementById('adminGenPrompt').value = data.generator || '';
    document.getElementById('adminEvalPrompt').value = data.evaluator || '';
    document.getElementById('adminRefPrompt').value = data.refiner || '';
}

async function savePrompts() {
    await fetch('/api/config/prompts', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            generator: document.getElementById('adminGenPrompt').value,
            evaluator: document.getElementById('adminEvalPrompt').value,
            refiner: document.getElementById('adminRefPrompt').value,
        })
    });
    alert('Promptok elmentve!');
}

async function loadAdminPresets() {
    const res = await fetch('/api/presets');
    const presets = await res.json();
    const container = document.getElementById('presetsList');
    let html = '';
    presets.forEach(p => {
        html += `
            <div class="admin-card">
                <h4>${p.name}</h4>
                <p style="color:var(--text-dim);font-size:12px;margin-bottom:8px;">${p.description || ''}</p>
                <details>
                    <summary style="cursor:pointer;color:var(--accent);font-size:12px;">Prompt megjelenítése</summary>
                    <pre style="margin-top:8px;padding:10px;background:var(--bg);border-radius:6px;font-size:11px;white-space:pre-wrap;color:var(--text-dim);">${p.user_prompt}</pre>
                </details>
            </div>`;
    });
    container.innerHTML = html || '<p style="color:var(--text-dim)">Nincsenek presetek.</p>';
}

async function loadAdminSessions() {
    const res = await fetch('/api/sessions');
    const sessions = await res.json();
    const container = document.getElementById('sessionsList');

    if (sessions.length === 0) {
        container.innerHTML = '<p style="color:var(--text-dim);padding:12px;">Még nincs session.</p>';
        return;
    }

    let html = '';
    sessions.forEach(s => {
        const statusColor = {
            done: 'var(--green)', running: 'var(--accent)', detecting: 'var(--purple)',
            paused: 'var(--orange)', stopped: 'var(--red)', idle: 'var(--text-dim)'
        }[s.status] || 'var(--text-dim)';

        html += `
            <div class="session-item" style="flex-wrap:wrap;gap:8px;align-items:flex-start;padding:12px;">
                <div style="display:flex;align-items:center;gap:8px;width:100%;flex-wrap:wrap;">
                    <span style="font-family:var(--font-mono);color:var(--accent);">${s.session_id}</span>
                    <span style="color:${statusColor};font-weight:600;">${s.status}</span>
                    <span style="color:var(--text-dim);font-size:11px;">${s.preset_name}</span>
                    <span style="color:var(--text-dim);font-size:11px;">${s.generator_model}</span>
                    <span style="color:var(--text-dim);font-size:11px;margin-left:auto;">
                        ${new Date(s.created_at).toLocaleString('hu-HU')}
                    </span>
                </div>
                <div style="width:100%;">
                    <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;"
                            onclick="toggleEvalPrompt('${s.session_id}', this)">
                        🎓 Értékelő prompt megtekintése
                    </button>
                    <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;"
                            onclick="window.open('/api/sessions/${s.session_id}/export')">
                        Export
                    </button>
                    <button class="btn btn-danger" style="padding:4px 10px;font-size:11px;"
                            onclick="deleteSession('${s.session_id}')">
                        Törlés
                    </button>
                </div>
                <div id="eval-panel-${s.session_id}" class="hidden" style="width:100%;margin-top:8px;"></div>
            </div>`;
    });
    container.innerHTML = html;
}

async function toggleEvalPrompt(sessionId, btn) {
    const panel = document.getElementById(`eval-panel-${sessionId}`);
    if (!panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        btn.textContent = '🎓 Értékelő prompt megtekintése';
        return;
    }

    btn.textContent = 'Betöltés...';
    const res = await fetch(`/api/sessions/${sessionId}/evaluator-prompt`);
    const data = await res.json();

    if (!data.generated_evaluator_prompt) {
        panel.innerHTML = `<p style="color:var(--text-dim);font-size:12px;padding:8px;">
            Ehhez a session-höz még nem lett szakterület azonosítva (a session indítása után generálódik).
        </p>`;
    } else {
        const criteriaHtml = (data.evaluation_criteria || [])
            .map(c => `<span class="criteria-pill">${c}</span>`).join('');

        panel.innerHTML = `
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:14px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
                    <span style="font-size:20px;">${getAdminDomainIcon(data.domain_en)}</span>
                    <div>
                        <div style="font-size:14px;font-weight:800;color:var(--green);">${data.expert_title || 'Szakértő'}</div>
                        <div style="font-size:11px;color:var(--text-dim);">${data.expert_description || ''}</div>
                    </div>
                    <span style="margin-left:auto;background:rgba(179,136,255,0.12);border:1px solid rgba(179,136,255,0.3);
                          color:var(--purple);padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;">
                        ${data.domain_detected || 'Általános'}
                    </span>
                </div>
                <div style="margin-bottom:10px;">${criteriaHtml}</div>
                <details>
                    <summary style="cursor:pointer;color:var(--accent);font-size:12px;font-weight:600;margin-bottom:6px;">
                        ▶ Teljes generált értékelő system prompt
                    </summary>
                    <div class="evaluator-prompt-box">${escHtml(data.generated_evaluator_prompt)}</div>
                </details>
                ${data.domain_detector_ms ? `<div style="font-size:10px;color:var(--text-dim);margin-top:6px;">
                    Generálási idő: ${(data.domain_detector_ms/1000).toFixed(1)}s
                </div>` : ''}
            </div>`;
    }

    panel.classList.remove('hidden');
    btn.textContent = '▲ Bezárás';
}

function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getAdminDomainIcon(domain_en) {
    const icons = {
        marketing:'📣', sales:'💼', software:'💻', programming:'🖥️', finance:'📊',
        legal:'⚖️', medical:'🏥', tourism:'✈️', gastronomy:'🍴', education:'🎓',
        hr:'👥', real_estate:'🏠', logistics:'🚚', literature:'📚', creative:'✍️',
        science:'🔬', engineering:'⚙️', default:'🤖'
    };
    if (!domain_en) return icons.default;
    const lower = domain_en.toLowerCase();
    for (const [k, v] of Object.entries(icons)) {
        if (lower.includes(k)) return v;
    }
    return icons.default;
}

async function deleteSession(id) {
    if (!confirm('Biztosan törölni akarod ezt a session-t?')) return;
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    loadAdminSessions();
}
