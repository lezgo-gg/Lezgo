import { supabase } from './supabase.js';

let currentUserId = null;

function setTournamentUser(userId) {
  currentUserId = userId;
}

async function getAuthToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

async function authFetch(url, options = {}) {
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

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatRank(tier, division) {
  if (!tier || tier === 'UNRANKED') return 'Unranked';
  const name = tier.charAt(0) + tier.slice(1).toLowerCase();
  if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)) return name;
  return name + ' ' + (division || '');
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const STATUS_LABELS = {
  open: 'Inscriptions',
  pending_partner: 'En attente',
  in_progress: 'En cours',
  completed: 'Termine',
  cancelled: 'Annule',
};

// ─── Data fetching ───────────────────────────────────────────

async function loadUpcomingTournaments(serverId) {
  let query = supabase
    .from('tournaments')
    .select('*, servers!tournaments_server_id_fkey(guild_name, guild_icon, guild_id), partner:servers!tournaments_partner_server_id_fkey(guild_name, guild_icon, guild_id)')
    .in('status', ['open', 'in_progress', 'pending_partner'])
    .order('starts_at', { ascending: true });

  if (serverId) {
    query = query.or(`server_id.eq.${serverId},partner_server_id.eq.${serverId}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadTournamentDetail(tournamentId) {
  try {
    const data = await authFetch(`/api/tournaments/${tournamentId}`);
    return data;
  } catch {
    // Fallback to public fetch
    const { data, error } = await supabase
      .from('tournaments')
      .select('*, servers!tournaments_server_id_fkey(guild_name, guild_icon, guild_id), partner:servers!tournaments_partner_server_id_fkey(guild_name, guild_icon, guild_id)')
      .eq('id', tournamentId)
      .single();

    if (error) throw error;

    const { data: participants } = await supabase
      .from('tournament_participants')
      .select('*, profiles:user_id(discord_username, discord_avatar, riot_game_name, riot_tag_line, rank_tier, rank_division)')
      .eq('tournament_id', tournamentId)
      .order('registered_at', { ascending: true });

    return { ...data, participants: participants || [] };
  }
}

// ─── Tournament cards rendering ──────────────────────────────

function renderTournamentCards(tournaments, container) {
  if (!tournaments || tournaments.length === 0) {
    container.innerHTML = '<p class="empty-note">Aucun tournoi a venir pour le moment.</p>';
    return;
  }

  container.innerHTML = tournaments.map(t => {
    const serverName = t.servers?.guild_name || '';
    const partnerName = t.partner?.guild_name || '';
    const crossLabel = t.is_cross_community && partnerName
      ? `<span class="tournament-server-name">${escapeHtml(serverName)}</span> <span class="tournament-cross-badge">&times;</span> <span class="tournament-server-name">${escapeHtml(partnerName)}</span>`
      : `<span class="tournament-server-name">${escapeHtml(serverName)}</span>`;

    const statusClass = `tournament-status-${t.status}`;
    const statusText = STATUS_LABELS[t.status] || t.status;

    return `
      <div class="tournament-card" data-tournament-id="${t.id}">
        <div class="tournament-card-header">
          <div class="tournament-card-servers">${crossLabel}</div>
          <span class="tournament-status ${statusClass}">${statusText}</span>
        </div>
        <h3 class="tournament-card-title">${escapeHtml(t.title)}</h3>
        <div class="tournament-card-meta">
          <span>${formatDate(t.starts_at)}</span>
          <span class="tournament-format-badge">${escapeHtml(t.format)}</span>
          <span>${t.participant_count}/${t.max_participants}</span>
        </div>
        ${t.prize ? `<div class="tournament-card-prize">${escapeHtml(t.prize)}</div>` : ''}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.tournament-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.tournamentId;
      showTournamentDetail(id);
    });
  });
}

// ─── Tournament detail view ──────────────────────────────────

async function showTournamentDetail(tournamentId) {
  const detailView = document.getElementById('browse-tournament-detail');
  if (!detailView) return;

  // Show the tournament detail sub-view
  document.getElementById('browse-servers')?.classList.add('hidden');
  document.getElementById('browse-server-detail')?.classList.add('hidden');
  document.getElementById('browse-tournaments')?.classList.add('hidden');
  detailView.classList.remove('hidden');

  const body = document.getElementById('tournament-detail-body');
  body.innerHTML = '<div class="loading-state">Chargement du tournoi...</div>';

  try {
    const t = await loadTournamentDetail(tournamentId);
    const serverName = t.servers?.guild_name || '';
    const partnerName = t.partner?.guild_name || '';
    const crossLabel = t.is_cross_community && partnerName
      ? `${escapeHtml(serverName)} <span class="tournament-cross-badge">&times;</span> ${escapeHtml(partnerName)}`
      : escapeHtml(serverName);

    const statusClass = `tournament-status-${t.status}`;
    const statusText = STATUS_LABELS[t.status] || t.status;

    // Check if user is registered
    const isRegistered = currentUserId && t.participants?.some(p => p.user_id === currentUserId);

    let registerBtn = '';
    if (currentUserId && t.status === 'open') {
      registerBtn = isRegistered
        ? `<button class="btn btn-secondary" id="btn-tournament-unregister">Se desinscrire</button>`
        : `<button class="btn btn-primary" id="btn-tournament-register">S'inscrire</button>`;
    } else if (!currentUserId && t.status === 'open') {
      registerBtn = `<button class="btn btn-discord btn-sm guest-cta-btn guest-tournament-cta">
        <svg width="16" height="12" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.4 37.4 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 4.9a.2.2 0 00-.1.1C1.5 18.7-.9 32.2.3 45.5v.2a58.9 58.9 0 0017.7 9 .2.2 0 00.3-.1 42.1 42.1 0 003.6-5.9.2.2 0 00-.1-.3 38.8 38.8 0 01-5.5-2.7.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 42 42 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .4 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.3 47.3 47.3 0 003.6 5.9.2.2 0 00.3.1A58.7 58.7 0 0070.5 45.7v-.2c1.4-15-2.3-28.1-9.8-39.7a.2.2 0 00-.1 0zM23.7 37.3c-3.4 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.1 6.3 7-2.8 7-6.3 7zm23.2 0c-3.4 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.1 6.3 7-2.8 7-6.3 7z"/></svg>
        Connecte-toi pour t'inscrire
      </button>`;
    }

    body.innerHTML = `
      <div class="tournament-detail-main">
        <div class="tournament-detail-header">
          <div>
            <div class="tournament-detail-servers">${crossLabel}</div>
            <h2>${escapeHtml(t.title)}</h2>
          </div>
          <div class="tournament-detail-badges">
            <span class="tournament-format-badge">${escapeHtml(t.format)}</span>
            <span class="tournament-status ${statusClass}">${statusText}</span>
          </div>
        </div>

        <div class="tournament-info-grid">
          <div class="tournament-info-item">
            <span class="tournament-info-label">Date</span>
            <span class="tournament-info-value">${formatDateTime(t.starts_at)}</span>
          </div>
          <div class="tournament-info-item">
            <span class="tournament-info-label">Inscrits</span>
            <span class="tournament-info-value">${t.participant_count} / ${t.max_participants}</span>
          </div>
          <div class="tournament-info-item">
            <span class="tournament-info-label">Rang requis</span>
            <span class="tournament-info-value">${t.rank_min || 'Aucun'} ${t.rank_max ? '- ' + t.rank_max : ''}</span>
          </div>
          <div class="tournament-info-item">
            <span class="tournament-info-label">Recompense</span>
            <span class="tournament-info-value">${escapeHtml(t.prize) || 'Aucune'}</span>
          </div>
        </div>

        ${t.description ? `<div class="tournament-detail-section"><h3>Description</h3><p>${escapeHtml(t.description)}</p></div>` : ''}
        ${t.rules ? `<div class="tournament-detail-section"><h3>Regles</h3><p>${escapeHtml(t.rules)}</p></div>` : ''}

        <div class="tournament-detail-actions">
          ${registerBtn}
        </div>
      </div>

      <div class="tournament-detail-sidebar">
        <h3>Participants (${(t.participants || []).length})</h3>
        <div class="tournament-participants-list" id="tournament-participants-list">
          ${renderParticipantsList(t.participants || [])}
        </div>
      </div>
    `;

    // Bind register/unregister
    const regBtn = document.getElementById('btn-tournament-register');
    if (regBtn) {
      regBtn.addEventListener('click', async () => {
        regBtn.disabled = true;
        regBtn.textContent = 'Inscription...';
        try {
          await registerForTournament(tournamentId);
          window.showToast('Inscrit au tournoi !');
          showTournamentDetail(tournamentId);
        } catch (err) {
          window.showToast(err.message, 'error');
          regBtn.disabled = false;
          regBtn.textContent = 'S\'inscrire';
        }
      });
    }

    const unregBtn = document.getElementById('btn-tournament-unregister');
    if (unregBtn) {
      unregBtn.addEventListener('click', async () => {
        unregBtn.disabled = true;
        try {
          await unregisterFromTournament(tournamentId);
          window.showToast('Desinscrit du tournoi');
          showTournamentDetail(tournamentId);
        } catch (err) {
          window.showToast(err.message, 'error');
          unregBtn.disabled = false;
        }
      });
    }

    // Guest CTA buttons (registration + participants overlay)
    body.querySelectorAll('.guest-cta-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { openAuthModal } = await import('./auth.js');
        openAuthModal();
      });
    });
  } catch (err) {
    body.innerHTML = `<div class="empty-state">Erreur: ${escapeHtml(err.message)}</div>`;
  }
}

function blurName(name) {
  if (!name || name.length <= 3) return '***';
  return escapeHtml(name.substring(0, 3)) + '***';
}

function renderParticipantRow(p, isGuest) {
  const profile = p.profiles || {};
  const name = profile.riot_game_name || profile.discord_username || '?';
  const tag = (!isGuest && profile.riot_tag_line) ? `#${escapeHtml(profile.riot_tag_line)}` : '';
  const displayName = isGuest ? blurName(name) : escapeHtml(name);
  const avatar = profile.discord_avatar
    ? `<img class="tournament-participant-avatar" src="${escapeHtml(profile.discord_avatar)}" alt="" />`
    : `<div class="tournament-participant-avatar tournament-participant-avatar-placeholder"></div>`;

  const rank = profile.rank_tier
    ? `<span class="player-rank rank-${profile.rank_tier}">${formatRank(profile.rank_tier, profile.rank_division)}</span>`
    : '';

  return `
    <div class="tournament-participant-row">
      ${avatar}
      <div class="tournament-participant-info">
        <span class="tournament-participant-name">${displayName}${tag}</span>
        ${rank}
      </div>
    </div>
  `;
}

function renderParticipantsList(participants) {
  if (participants.length === 0) {
    return '<p class="empty-note">Aucun participant pour le moment.</p>';
  }

  const isGuest = !currentUserId;

  if (!isGuest) {
    return participants.map(p => renderParticipantRow(p, false)).join('');
  }

  // Guest mode: show first 3, blur the rest
  const visible = participants.slice(0, 3);
  const hidden = participants.slice(3);
  let html = visible.map(p => renderParticipantRow(p, true)).join('');

  if (hidden.length > 0) {
    html += `
      <div class="guest-participants-overlay">
        <div class="guest-participants-blur">
          ${hidden.map(p => renderParticipantRow(p, true)).join('')}
        </div>
        <div class="guest-overlay-cta">
          <span>+${hidden.length} participant${hidden.length > 1 ? 's' : ''}</span>
          <button class="btn btn-primary btn-sm guest-cta-btn">Connecte-toi pour voir</button>
        </div>
      </div>
    `;
  }

  return html;
}

// ─── Registration ────────────────────────────────────────────

async function registerForTournament(tournamentId) {
  return authFetch(`/api/tournaments/${tournamentId}/register`, { method: 'POST' });
}

async function unregisterFromTournament(tournamentId) {
  return authFetch(`/api/tournaments/${tournamentId}/register`, { method: 'DELETE' });
}

// ─── Browse integration ──────────────────────────────────────

async function loadBrowseTournaments() {
  const container = document.getElementById('tournaments-grid');
  if (!container) return;

  try {
    const tournaments = await loadUpcomingTournaments();
    renderTournamentCards(tournaments, container);
  } catch {
    container.innerHTML = '<p class="empty-note">Erreur de chargement des tournois.</p>';
  }
}

async function refreshServerTournaments(serverId) {
  const container = document.getElementById('server-tournaments-list');
  if (!container) return;

  try {
    const tournaments = await loadUpcomingTournaments(serverId);
    if (tournaments.length === 0) {
      container.innerHTML = '<p class="empty-note">Aucun tournoi à venir pour cette communauté.</p>';
      return;
    }
    renderTournamentCards(tournaments, container);
  } catch {
    container.innerHTML = '<p class="empty-note">Erreur de chargement.</p>';
  }
}

// ─── Streamer management ─────────────────────────────────────

async function initTournamentManagement(serverId) {
  const section = document.getElementById('streamer-tournaments');
  if (!section) return;
  section.classList.remove('hidden');

  // Load incoming requests
  await loadIncomingTournamentRequests(serverId);

  // Load server tournaments
  await loadServerTournamentsList(serverId);

  // Bind create form
  bindCreateTournamentForm(serverId);
}

async function loadIncomingTournamentRequests(serverId) {
  const container = document.getElementById('tournament-requests-list');
  if (!container) return;

  try {
    const requests = await authFetch(`/api/tournament-requests?server_id=${serverId}`);
    if (!requests || requests.length === 0) {
      container.innerHTML = '<p class="empty-note">Aucune demande en attente.</p>';
      return;
    }

    container.innerHTML = requests.map(r => {
      const tournament = r.tournaments || {};
      const fromServer = tournament.servers?.guild_name || '';
      return `
        <div class="tournament-request-card">
          <div class="tournament-request-info">
            <strong>${escapeHtml(tournament.title || 'Tournoi')}</strong>
            <span>De: ${escapeHtml(fromServer)}</span>
            <span>${escapeHtml(tournament.format || '')} - ${formatDate(tournament.starts_at)}</span>
            ${r.message ? `<p class="tournament-request-message">${escapeHtml(r.message)}</p>` : ''}
          </div>
          <div class="tournament-request-actions">
            <button class="btn btn-primary btn-sm" data-accept-request="${r.id}">Accepter</button>
            <button class="btn btn-ghost btn-sm" data-decline-request="${r.id}">Refuser</button>
          </div>
        </div>
      `;
    }).join('');

    // Bind accept/decline
    container.querySelectorAll('[data-accept-request]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await acceptRequest(btn.dataset.acceptRequest);
          window.showToast('Demande acceptee !');
          await loadIncomingTournamentRequests(serverId);
        } catch (err) {
          window.showToast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('[data-decline-request]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await declineRequest(btn.dataset.declineRequest);
          window.showToast('Demande refusee');
          await loadIncomingTournamentRequests(serverId);
        } catch (err) {
          window.showToast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });
  } catch {
    container.innerHTML = '<p class="empty-note">Erreur de chargement.</p>';
  }
}

async function acceptRequest(requestId) {
  return authFetch(`/api/tournament-requests/${requestId}/accept`, { method: 'POST' });
}

async function declineRequest(requestId) {
  return authFetch(`/api/tournament-requests/${requestId}/decline`, { method: 'POST' });
}

async function loadServerTournamentsList(serverId) {
  const container = document.getElementById('streamer-tournaments-list');
  if (!container) return;

  try {
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .eq('server_id', serverId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = '<p class="empty-note">Aucun tournoi cree.</p>';
      return;
    }

    container.innerHTML = data.map(t => {
      const statusClass = `tournament-status-${t.status}`;
      const statusText = STATUS_LABELS[t.status] || t.status;
      return `
        <div class="tournament-manage-row">
          <div class="tournament-manage-info">
            <strong>${escapeHtml(t.title)}</strong>
            <span>${escapeHtml(t.format)} - ${formatDate(t.starts_at)} - ${t.participant_count}/${t.max_participants}</span>
          </div>
          <span class="tournament-status ${statusClass}">${statusText}</span>
        </div>
      `;
    }).join('');
  } catch {
    container.innerHTML = '<p class="empty-note">Erreur de chargement.</p>';
  }
}

function bindCreateTournamentForm(serverId) {
  const toggleBtn = document.getElementById('btn-toggle-tournament-form');
  const form = document.getElementById('tournament-create-form');
  if (!toggleBtn || !form || toggleBtn.dataset.bound) return;
  toggleBtn.dataset.bound = '1';

  toggleBtn.addEventListener('click', () => {
    form.classList.toggle('hidden');
  });

  const cancelBtn = document.getElementById('btn-cancel-tournament');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      form.classList.add('hidden');
      form.reset?.();
    });
  }

  // Cross-community toggle
  const crossToggle = document.getElementById('tournament-cross-toggle');
  const crossSection = document.getElementById('tournament-cross-section');
  if (crossToggle && crossSection) {
    crossToggle.addEventListener('change', () => {
      crossSection.classList.toggle('hidden', !crossToggle.checked);
    });
  }

  // Load target servers for cross-community
  loadTargetServers(serverId);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creation...';

    try {
      const data = {
        title: document.getElementById('tournament-title').value,
        description: document.getElementById('tournament-description').value,
        format: document.getElementById('tournament-format').value,
        server_id: serverId,
        max_participants: parseInt(document.getElementById('tournament-max').value) || 32,
        rank_min: document.getElementById('tournament-rank-min').value || null,
        rank_max: document.getElementById('tournament-rank-max').value || null,
        prize: document.getElementById('tournament-prize').value || null,
        rules: document.getElementById('tournament-rules').value || '',
        starts_at: document.getElementById('tournament-starts-at').value,
        ends_at: document.getElementById('tournament-ends-at').value || null,
        is_cross_community: crossToggle?.checked || false,
        target_server_id: crossToggle?.checked ? document.getElementById('tournament-target-server').value : null,
      };

      await createTournament(data);
      window.showToast('Tournoi cree !');
      form.classList.add('hidden');
      form.reset?.();
      await loadServerTournamentsList(serverId);
    } catch (err) {
      window.showToast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Creer le tournoi';
    }
  });
}

async function loadTargetServers(excludeServerId) {
  const select = document.getElementById('tournament-target-server');
  if (!select) return;

  const { data: servers } = await supabase
    .from('servers')
    .select('id, guild_name')
    .eq('licensed', true)
    .neq('id', excludeServerId)
    .order('guild_name');

  if (servers) {
    select.innerHTML = '<option value="">Choisir une communauté...</option>' +
      servers.map(s => `<option value="${s.id}">${escapeHtml(s.guild_name)}</option>`).join('');
  }
}

async function createTournament(data) {
  return authFetch('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ─── Exports ─────────────────────────────────────────────────

export {
  setTournamentUser,
  loadUpcomingTournaments,
  renderTournamentCards,
  loadTournamentDetail,
  showTournamentDetail,
  registerForTournament,
  unregisterFromTournament,
  initTournamentManagement,
  loadIncomingTournamentRequests,
  acceptRequest,
  declineRequest,
  createTournament,
  loadBrowseTournaments,
  refreshServerTournaments,
};
