import { supabase } from './supabase.js';

let adminInitialized = false;
let currentFilter = 'all'; // 'all' | 'licensed' | 'unlicensed'

export async function initAdmin() {
  if (!adminInitialized) {
    adminInitialized = true;
    bindAdminEvents();
  }
  await Promise.all([loadAdminStats(), loadAdminServers()]);
}

function bindAdminEvents() {
  // Filter tabs
  document.querySelectorAll('.admin-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      loadAdminServers();
    });
  });

  // Add server form
  const addForm = document.getElementById('admin-add-server-form');
  if (addForm) {
    addForm.addEventListener('submit', handleAddServer);
  }

  // Toggle add server form
  const toggleBtn = document.getElementById('admin-toggle-add-server');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const form = document.getElementById('admin-add-server-container');
      form.classList.toggle('hidden');
    });
  }
}

async function getAuthToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

async function adminFetch(url, options = {}) {
  const token = await getAuthToken();
  if (!token) throw new Error('Non authentifie');

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

async function loadAdminStats() {
  const container = document.getElementById('admin-stats');
  if (!container) return;

  try {
    const stats = await adminFetch('/api/admin/stats');
    container.innerHTML = `
      <div class="admin-stat-card">
        <span class="admin-stat-value">${stats.totalPlayers}</span>
        <span class="admin-stat-label">Joueurs total</span>
      </div>
      <div class="admin-stat-card">
        <span class="admin-stat-value">${stats.licensedServers}</span>
        <span class="admin-stat-label">Serveurs licencies</span>
      </div>
      <div class="admin-stat-card">
        <span class="admin-stat-value">${stats.activePlayers}</span>
        <span class="admin-stat-label">Joueurs actifs (7j)</span>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p class="admin-error">Erreur stats: ${esc(err.message)}</p>`;
  }
}

async function loadAdminServers() {
  const tbody = document.getElementById('admin-servers-tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="admin-loading">Chargement...</td></tr>';

  try {
    const servers = await adminFetch('/api/admin/servers');

    const filtered = servers.filter(s => {
      if (currentFilter === 'licensed') return s.licensed;
      if (currentFilter === 'unlicensed') return !s.licensed;
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="admin-empty">Aucun serveur</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(server => {
      const iconUrl = server.guild_icon
        ? `https://cdn.discordapp.com/icons/${esc(server.guild_id)}/${esc(server.guild_icon)}.png?size=32`
        : '';
      const iconHtml = iconUrl
        ? `<img class="admin-server-icon" src="${iconUrl}" alt="" />`
        : '<span class="admin-server-icon-placeholder"></span>';

      const licenseBadge = server.licensed
        ? '<span class="admin-badge admin-badge-active">Actif</span>'
        : '<span class="admin-badge admin-badge-inactive">Inactif</span>';

      const expiresAt = server.license_expires_at
        ? new Date(server.license_expires_at).toLocaleDateString('fr-FR')
        : '-';

      const toggleLabel = server.licensed ? 'Desactiver' : 'Activer';
      const toggleClass = server.licensed ? 'btn-ghost' : 'btn-primary';

      return `
        <tr>
          <td class="admin-server-cell">
            ${iconHtml}
            <span>${esc(server.guild_name)}</span>
          </td>
          <td class="admin-guild-id">${esc(server.guild_id)}</td>
          <td>${server.member_count || 0}</td>
          <td>${licenseBadge}</td>
          <td>${esc(server.license_label || '-')}</td>
          <td>${esc(server.license_price != null ? server.license_price + ' EUR' : '-')}</td>
          <td>${expiresAt}</td>
          <td>
            <button class="btn btn-sm ${toggleClass} admin-toggle-license"
                    data-server-id="${esc(server.id)}"
                    data-licensed="${server.licensed ? '1' : '0'}"
                    data-guild-name="${esc(server.guild_name)}">
              ${toggleLabel}
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Bind toggle buttons
    tbody.querySelectorAll('.admin-toggle-license').forEach(btn => {
      btn.addEventListener('click', () => handleToggleLicense(btn));
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="admin-error">Erreur: ${esc(err.message)}</td></tr>`;
  }
}

async function handleToggleLicense(btn) {
  const serverId = btn.dataset.serverId;
  const currentlyLicensed = btn.dataset.licensed === '1';
  const guildName = btn.dataset.guildName;

  if (currentlyLicensed) {
    // Deactivate
    btn.disabled = true;
    btn.textContent = 'Desactivation...';
    try {
      await adminFetch('/api/admin/license', {
        method: 'POST',
        body: JSON.stringify({
          server_id: serverId,
          licensed: false,
        }),
      });
      window.showToast(`Licence desactivee pour ${guildName}`);
      await loadAdminServers();
    } catch (err) {
      window.showToast('Erreur: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Desactiver';
    }
  } else {
    // Activate - show inline form
    const label = prompt('Label de licence (ex: Gold, Platinum, Custom):', 'Standard');
    if (!label) return;
    const price = prompt('Prix mensuel (EUR):', '0');
    if (price === null) return;
    const months = prompt('Duree en mois:', '1');
    if (!months) return;

    btn.disabled = true;
    btn.textContent = 'Activation...';

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + parseInt(months, 10));

    try {
      await adminFetch('/api/admin/license', {
        method: 'POST',
        body: JSON.stringify({
          server_id: serverId,
          licensed: true,
          license_label: label,
          license_price: parseFloat(price) || 0,
          license_started_at: now.toISOString(),
          license_expires_at: expiresAt.toISOString(),
        }),
      });
      window.showToast(`Licence activee pour ${guildName}`);
      await loadAdminServers();
    } catch (err) {
      window.showToast('Erreur: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Activer';
    }
  }
}

async function handleAddServer(e) {
  e.preventDefault();

  const guildId = document.getElementById('admin-add-guild-id').value.trim();
  const guildName = document.getElementById('admin-add-guild-name').value.trim();
  const guildIcon = document.getElementById('admin-add-guild-icon').value.trim();

  if (!guildId || !guildName) {
    window.showToast('Guild ID et nom requis', 'error');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Ajout...';

  try {
    await adminFetch('/api/admin/servers', {
      method: 'POST',
      body: JSON.stringify({
        guild_id: guildId,
        guild_name: guildName,
        guild_icon: guildIcon || null,
      }),
    });
    window.showToast(`Serveur ${guildName} ajoute`);
    document.getElementById('admin-add-server-form').reset();
    document.getElementById('admin-add-server-container').classList.add('hidden');
    await loadAdminServers();
  } catch (err) {
    window.showToast('Erreur: ' + err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Ajouter';
  }
}

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
