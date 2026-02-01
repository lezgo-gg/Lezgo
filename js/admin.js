import { supabase } from './supabase.js';

let adminInitialized = false;
let currentFilter = 'all'; // 'all' | 'licensed' | 'unlicensed'

export async function initAdmin() {
  if (!adminInitialized) {
    adminInitialized = true;
    bindAdminEvents();
  }
  await Promise.all([loadAdminStats(), loadAdminServers(), loadAdminRequests()]);
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
  if (!token) throw new Error('Non authentifié');

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
        <span class="admin-stat-label">Serveurs licenciés</span>
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

  tbody.innerHTML = '<tr><td colspan="9" class="admin-loading">Chargement...</td></tr>';

  try {
    const servers = await adminFetch('/api/admin/servers');

    const filtered = servers.filter(s => {
      if (currentFilter === 'licensed') return s.licensed;
      if (currentFilter === 'unlicensed') return !s.licensed;
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="admin-empty">Aucun serveur</td></tr>';
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

      const isPublic = server.public !== false;
      const visibilityBadge = isPublic
        ? '<span class="admin-badge admin-badge-active">Public</span>'
        : '<span class="admin-badge admin-badge-inactive">Prive</span>';
      const visToggleLabel = isPublic ? 'Prive' : 'Public';
      const isLicensed = !!server.licensed;

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
          <td>
            ${visibilityBadge}
            <button class="btn btn-sm btn-ghost admin-toggle-visibility"
                    data-server-id="${esc(server.id)}"
                    data-public="${isPublic ? '1' : '0'}"
                    data-licensed="${isLicensed ? '1' : '0'}"
                    data-guild-name="${esc(server.guild_name)}">
              ${visToggleLabel}
            </button>
          </td>
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

    // Bind visibility toggle buttons
    tbody.querySelectorAll('.admin-toggle-visibility').forEach(btn => {
      btn.addEventListener('click', () => handleToggleVisibility(btn));
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="admin-error">Erreur: ${esc(err.message)}</td></tr>`;
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
      window.showToast(`Licence désactivée pour ${guildName}`);
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
    const months = prompt('Durée en mois:', '1');
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
      window.showToast(`Licence activée pour ${guildName}`);
      await loadAdminServers();
    } catch (err) {
      window.showToast('Erreur: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Activer';
    }
  }
}

async function handleToggleVisibility(btn) {
  const serverId = btn.dataset.serverId;
  const currentlyPublic = btn.dataset.public === '1';
  const currentlyLicensed = btn.dataset.licensed === '1';
  const guildName = btn.dataset.guildName;

  btn.disabled = true;
  btn.textContent = '...';

  try {
    await adminFetch('/api/admin/license', {
      method: 'POST',
      body: JSON.stringify({
        server_id: serverId,
        licensed: currentlyLicensed,
        public: !currentlyPublic,
      }),
    });
    window.showToast(`${guildName} est maintenant ${!currentlyPublic ? 'public' : 'privé'}`);
    await loadAdminServers();
  } catch (err) {
    window.showToast('Erreur: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = currentlyPublic ? 'Prive' : 'Public';
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
    window.showToast(`Serveur ${guildName} ajouté`);
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

// =====================================================
// ADMIN REQUESTS MANAGEMENT
// =====================================================

async function loadAdminRequests() {
  const list = document.getElementById('admin-requests-list');
  const countBadge = document.getElementById('admin-requests-count');
  if (!list) return;

  list.innerHTML = '<p class="admin-loading">Chargement...</p>';

  try {
    const requests = await adminFetch('/api/admin/requests');

    const pendingCount = requests.filter(r => r.status === 'pending' || r.status === 'payment_received').length;
    if (countBadge) {
      countBadge.textContent = pendingCount > 0 ? pendingCount : '';
      countBadge.classList.toggle('hidden', pendingCount === 0);
    }

    if (requests.length === 0) {
      list.innerHTML = '<p class="admin-empty">Aucune demande</p>';
      return;
    }

    list.innerHTML = requests.map(req => {
      const avatarUrl = req.discord_avatar || '';
      const avatarHtml = avatarUrl
        ? `<img class="admin-req-avatar" src="${esc(avatarUrl)}" alt="" />`
        : '<span class="admin-req-avatar-placeholder"></span>';

      const date = new Date(req.created_at).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'short', year: 'numeric',
      });

      let statusBadge = '';
      let actionsHtml = '';

      switch (req.status) {
        case 'pending':
          statusBadge = '<span class="admin-badge admin-badge-pending">En attente</span>';
          actionsHtml = `
            <button class="btn btn-sm btn-primary admin-req-action" data-action="payment" data-id="${esc(req.id)}">Paiement reçu</button>
            <button class="btn btn-sm btn-ghost admin-req-action" data-action="reject" data-id="${esc(req.id)}">Rejeter</button>
          `;
          break;
        case 'payment_received':
          statusBadge = '<span class="admin-badge admin-badge-payment">Paiement reçu</span>';
          actionsHtml = `
            <button class="btn btn-sm btn-primary admin-req-action" data-action="confirm" data-id="${esc(req.id)}">Activer la licence</button>
            <button class="btn btn-sm btn-ghost admin-req-action" data-action="reject" data-id="${esc(req.id)}">Rejeter</button>
          `;
          break;
        case 'active':
          statusBadge = '<span class="admin-badge admin-badge-active">Actif</span>';
          break;
        case 'rejected':
          statusBadge = '<span class="admin-badge admin-badge-rejected">Refuse</span>';
          break;
      }

      const guildIconUrl = req.guild_icon
        ? `https://cdn.discordapp.com/icons/${esc(req.guild_id)}/${esc(req.guild_icon)}.png?size=32`
        : '';
      const guildIconHtml = guildIconUrl
        ? `<img class="admin-req-guild-icon" src="${guildIconUrl}" alt="" />`
        : '';

      return `
        <div class="admin-req-card" data-status="${esc(req.status)}">
          <div class="admin-req-user">
            ${avatarHtml}
            <div class="admin-req-user-info">
              <span class="admin-req-username">${esc(req.discord_username || 'Utilisateur')}</span>
              <span class="admin-req-date">${date}</span>
            </div>
          </div>
          <div class="admin-req-server">
            ${guildIconHtml}
            <div>
              <span class="admin-req-guild-name">${esc(req.guild_name)}</span>
              <span class="admin-req-guild-id">${esc(req.guild_id)}</span>
            </div>
          </div>
          <div class="admin-req-status">${statusBadge}</div>
          <div class="admin-req-actions">${actionsHtml}</div>
        </div>
      `;
    }).join('');

    // Bind action buttons
    list.querySelectorAll('.admin-req-action').forEach(btn => {
      btn.addEventListener('click', () => handleRequestAction(btn));
    });

  } catch (err) {
    list.innerHTML = `<p class="admin-error">Erreur: ${esc(err.message)}</p>`;
  }
}

async function handleRequestAction(btn) {
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '...';

  try {
    switch (action) {
      case 'payment':
        await adminFetch(`/api/admin/requests/${id}/payment`, { method: 'POST' });
        window.showToast('Paiement marqué comme reçu');
        break;

      case 'confirm':
        await adminFetch(`/api/admin/requests/${id}/confirm`, { method: 'POST' });
        window.showToast('Licence activée !');
        break;

      case 'reject': {
        const note = prompt('Raison du refus (optionnel):');
        await adminFetch(`/api/admin/requests/${id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ admin_note: note || null }),
        });
        window.showToast('Demande rejetée');
        break;
      }
    }

    await loadAdminRequests();
    await loadAdminServers();
    await loadAdminStats();
  } catch (err) {
    window.showToast('Erreur: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
