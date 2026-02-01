import { supabase } from './supabase.js';
import {
  loadAllServers,
  loadPublicLicensedServers,
  joinServerByGuildId,
  leaveServer,
  createLfgPost,
  getActiveLfgPosts,
  deleteLfgPost,
} from './servers.js';
import {
  setTournamentUser,
  loadBrowseTournaments,
  refreshServerTournaments,
  showTournamentDetail,
} from './tournaments.js';

let currentUserId = null;
let currentUserProfile = null;
let serverDetailInitialized = false;
let currentServerData = null;

// ─── Public API ───────────────────────────────────────────────

export function initBrowse(userId, myProfile) {
  currentUserId = userId;
  currentUserProfile = myProfile || null;
  setTournamentUser(userId);

  const browseView = document.getElementById('view-browse');
  if (browseView) browseView.classList.toggle('guest-mode', !currentUserId);
  manageGuestCtaBar(!currentUserId);

  if (!serverDetailInitialized) {
    serverDetailInitialized = true;
    initServerDetailUI();
    initTournamentDetailUI();
  }

  loadServers();
}

export { getPlayerCount };

// ─── Server list ──────────────────────────────────────────────

export async function loadServers() {
  showSubView('browse-servers');
  const grid = document.getElementById('servers-grid');
  grid.innerHTML = '<div class="loading-state">Chargement des communautés...</div>';

  try {
    const servers = await loadPublicLicensedServers();
    renderServers(servers);
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">Erreur: ${escapeHtml(err.message)}</div>`;
  }

  // Also load tournaments
  loadBrowseTournaments();
}

function renderServers(servers) {
  const grid = document.getElementById('servers-grid');

  if (servers.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <p>Aucune communauté disponible pour le moment.</p>
        <p style="margin-top:0.5rem;color:var(--text-muted)">De nouvelles communautés arrivent bientôt !</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = servers.map(server => {
    const iconUrl = server.guild_icon
      ? `https://cdn.discordapp.com/icons/${escapeHtml(server.guild_id)}/${escapeHtml(server.guild_icon)}.png?size=128`
      : '';
    const iconHtml = iconUrl
      ? `<img class="server-card-icon" src="${iconUrl}" alt="" />`
      : `<div class="server-card-icon server-card-icon-placeholder"></div>`;

    return `
      <div class="server-card" data-guild-id="${escapeHtml(server.guild_id)}">
        ${iconHtml}
        <div class="server-card-info">
          <span class="server-card-name">${escapeHtml(server.guild_name)}</span>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.server-card').forEach(card => {
    card.addEventListener('click', () => {
      loadServerDetail(card.dataset.guildId);
    });
  });
}

// ─── Server detail ────────────────────────────────────────────

export async function loadServerDetail(guildId) {
  showSubView('browse-server-detail');

  const { data: server, error } = await supabase
    .from('servers')
    .select('*')
    .eq('guild_id', guildId)
    .single();

  if (error || !server) {
    window.showToast('Serveur introuvable', 'error');
    showSubView('browse-servers');
    return;
  }

  currentServerData = server;

  // Populate header
  const iconUrl = server.guild_icon
    ? `https://cdn.discordapp.com/icons/${server.guild_id}/${server.guild_icon}.png?size=128`
    : '';
  const iconEl = document.getElementById('server-detail-icon');
  if (iconUrl) {
    iconEl.src = iconUrl;
    iconEl.style.display = '';
  } else {
    iconEl.style.display = 'none';
  }
  document.getElementById('server-detail-name').textContent = server.guild_name;

  // Guest server CTA banner
  const existingBanner = document.getElementById('guest-server-banner');
  if (existingBanner) existingBanner.remove();

  if (!currentUserId) {
    const lfgSection = document.getElementById('lfg-posts-list');
    if (lfgSection) {
      const banner = document.createElement('div');
      banner.id = 'guest-server-banner';
      banner.className = 'guest-server-cta-banner';
      banner.innerHTML = `
        <p>Connecte-toi pour rejoindre cette communauté, publier des annonces de groupe et participer aux tournois !</p>
        <button class="btn btn-discord btn-sm" id="guest-server-banner-btn">
          <svg width="16" height="12" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.4 37.4 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 4.9a.2.2 0 00-.1.1C1.5 18.7-.9 32.2.3 45.5v.2a58.9 58.9 0 0017.7 9 .2.2 0 00.3-.1 42.1 42.1 0 003.6-5.9.2.2 0 00-.1-.3 38.8 38.8 0 01-5.5-2.7.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 42 42 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .4 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.3 47.3 47.3 0 003.6 5.9.2.2 0 00.3.1A58.7 58.7 0 0070.5 45.7v-.2c1.4-15-2.3-28.1-9.8-39.7a.2.2 0 00-.1 0zM23.7 37.3c-3.4 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.1 6.3 7-2.8 7-6.3 7zm23.2 0c-3.4 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.1 6.3 7-2.8 7-6.3 7z"/></svg>
          Connecte-toi
        </button>
      `;
      lfgSection.parentNode.insertBefore(banner, lfgSection);

      banner.querySelector('#guest-server-banner-btn').addEventListener('click', async () => {
        const { openAuthModal } = await import('./auth.js');
        openAuthModal();
      });
    }
  }

  updateJoinLeaveButtons(server.id);
  refreshLfgPosts(server.id);
  refreshServerTournaments(server.id);
}

async function updateJoinLeaveButtons(serverId) {
  const btnJoin = document.getElementById('btn-join-server');
  const btnLeave = document.getElementById('btn-leave-server');

  // Join is always hidden — joining happens via Discord bot token
  btnJoin.classList.add('hidden');

  if (!currentUserId) {
    btnLeave.classList.add('hidden');
    document.getElementById('btn-create-lfg').classList.add('hidden');
    return;
  }

  const { data } = await supabase
    .from('server_members')
    .select('id')
    .eq('server_id', serverId)
    .eq('user_id', currentUserId)
    .maybeSingle();

  if (data) {
    btnLeave.classList.remove('hidden');
    document.getElementById('btn-create-lfg').classList.remove('hidden');
  } else {
    btnLeave.classList.add('hidden');
    document.getElementById('btn-create-lfg').classList.add('hidden');
  }
}

function initServerDetailUI() {
  document.getElementById('btn-back-servers').addEventListener('click', () => {
    loadServers();
  });

  document.getElementById('btn-join-server').addEventListener('click', async () => {
    if (!currentUserId) {
      const { openAuthModal } = await import('./auth.js');
      openAuthModal();
      return;
    }
    if (!currentServerData) return;
    try {
      await joinServerByGuildId(currentServerData.guild_id, currentUserId);
      window.showToast('Tu as rejoint la communauté !');
      loadServerDetail(currentServerData.guild_id);
    } catch (err) {
      window.showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-leave-server').addEventListener('click', async () => {
    if (!currentServerData || !currentUserId) return;
    try {
      await leaveServer(currentServerData.id, currentUserId);
      window.showToast('Tu as quitté la communauté');
      loadServerDetail(currentServerData.guild_id);
    } catch (err) {
      window.showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-create-lfg').addEventListener('click', () => {
    document.getElementById('lfg-form-container').classList.remove('hidden');
    document.getElementById('btn-create-lfg').classList.add('hidden');
  });

  document.getElementById('btn-cancel-lfg').addEventListener('click', () => {
    document.getElementById('lfg-form-container').classList.add('hidden');
    document.getElementById('btn-create-lfg').classList.remove('hidden');
  });

  document.getElementById('lfg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentServerData || !currentUserId) return;
    const role = document.getElementById('lfg-role').value;
    const note = document.getElementById('lfg-note').value;
    try {
      await createLfgPost(currentServerData.id, currentUserId, role, note);
      window.showToast('Annonce publiée !');
      document.getElementById('lfg-form').reset();
      document.getElementById('lfg-form-container').classList.add('hidden');
      document.getElementById('btn-create-lfg').classList.remove('hidden');
      refreshLfgPosts(currentServerData.id);
    } catch (err) {
      window.showToast(err.message, 'error');
    }
  });
}

async function refreshLfgPosts(serverId) {
  const container = document.getElementById('lfg-posts-list');

  // Guests cannot see LFG posts
  if (!currentUserId) {
    container.innerHTML = `
      <div class="empty-note" style="text-align:center;padding:1.5rem 1rem;">
        Connecte-toi pour voir les joueurs qui cherchent un groupe.
      </div>`;
    return;
  }

  try {
    const posts = await getActiveLfgPosts(serverId);
    renderLfgPosts(posts, container);
  } catch {
    container.innerHTML = '<p class="empty-note">Erreur de chargement des annonces</p>';
  }
}

function renderLfgPosts(posts, container) {
  if (posts.length === 0) {
    container.innerHTML = '<p class="empty-note">Aucune annonce active. Sois le premier a chercher un groupe !</p>';
    return;
  }

  const roleMap = { TOP: 'TOP', JUNGLE: 'JGL', MID: 'MID', ADC: 'ADC', SUPPORT: 'SUP' };

  const isGuest = !currentUserId;

  container.innerHTML = posts.map(post => {
    const profile = post.profiles || {};
    const avatarHtml = profile.discord_avatar
      ? `<img class="lfg-post-avatar" src="${escapeHtml(profile.discord_avatar)}" alt="" />`
      : `<div class="lfg-post-avatar lfg-post-avatar-placeholder"></div>`;

    const roleBadge = (!isGuest && post.wanted_role)
      ? `<span class="role-tag">${roleMap[post.wanted_role] || post.wanted_role}</span>`
      : '';

    const rankBadge = profile.rank_tier
      ? `<span class="player-rank rank-${profile.rank_tier}">${formatRank(profile.rank_tier, profile.rank_division)}</span>`
      : '';

    const expiresAt = new Date(post.expires_at);
    const remaining = Math.max(0, expiresAt - Date.now());
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const timerText = remaining > 0 ? `${hours}h${String(minutes).padStart(2, '0')}` : 'Expire';

    const displayName = isGuest
      ? blurName(profile.riot_game_name || profile.discord_username || '?')
      : `${escapeHtml(profile.riot_game_name || profile.discord_username || '?')}${profile.riot_tag_line ? '#' + escapeHtml(profile.riot_tag_line) : ''}`;

    const actionBtn = isGuest
      ? `<button class="btn btn-primary btn-sm guest-cta-btn">Connecte-toi</button>`
      : profile.discord_id
        ? `<a href="https://discord.com/users/${escapeHtml(profile.discord_id)}" target="_blank" rel="noopener" class="btn btn-discord btn-sm">Discord</a>`
        : '';

    const deleteBtn = (currentUserId && post.user_id === currentUserId)
      ? `<button class="btn btn-ghost btn-sm lfg-delete-btn" data-lfg-id="${post.id}">&times;</button>`
      : '';

    return `
      <div class="lfg-post">
        <div class="lfg-post-user">
          ${avatarHtml}
          <div class="lfg-post-info">
            <span class="lfg-post-name">${displayName}</span>
            <div class="lfg-post-meta">${rankBadge} ${roleBadge}</div>
          </div>
        </div>
        ${post.note ? `<div class="lfg-post-note">${escapeHtml(post.note)}</div>` : ''}
        <div class="lfg-post-actions">
          <span class="lfg-post-timer" title="Expire a ${expiresAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}">${timerText}</span>
          ${actionBtn}
          ${deleteBtn}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.lfg-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await deleteLfgPost(btn.dataset.lfgId);
        window.showToast('Annonce supprimée');
        if (currentServerData) refreshLfgPosts(currentServerData.id);
      } catch (err) {
        window.showToast(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('.guest-cta-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { openAuthModal } = await import('./auth.js');
      openAuthModal();
    });
  });
}

// ─── Tournament detail UI ─────────────────────────────────────

function initTournamentDetailUI() {
  const backBtn = document.getElementById('btn-back-tournaments');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      loadServers();
    });
  }
}

// ─── Sub-view toggle ──────────────────────────────────────────

function showSubView(id) {
  document.getElementById('browse-servers').classList.toggle('hidden', id !== 'browse-servers');
  document.getElementById('browse-server-detail').classList.toggle('hidden', id !== 'browse-server-detail');
  const tournamentDetail = document.getElementById('browse-tournament-detail');
  if (tournamentDetail) tournamentDetail.classList.toggle('hidden', id !== 'browse-tournament-detail');
  // Show/hide tournaments section with servers list
  const tournamentsSection = document.getElementById('browse-tournaments');
  if (tournamentsSection) tournamentsSection.classList.toggle('hidden', id !== 'browse-servers');
}

// ─── Guest mode ───────────────────────────────────────────────

async function manageGuestCtaBar(isGuest) {
  const existing = document.getElementById('guest-cta-bar');
  if (!isGuest) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return; // already present

  const bar = document.createElement('div');
  bar.id = 'guest-cta-bar';
  bar.className = 'guest-cta-bar';
  bar.innerHTML = `
    <span class="guest-cta-bar-text">Connecte-toi avec Discord pour accéder à toutes les fonctionnalités</span>
    <button class="btn btn-discord btn-sm" id="guest-cta-bar-btn">
      <svg width="16" height="12" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.4 37.4 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 4.9a.2.2 0 00-.1.1C1.5 18.7-.9 32.2.3 45.5v.2a58.9 58.9 0 0017.7 9 .2.2 0 00.3-.1 42.1 42.1 0 003.6-5.9.2.2 0 00-.1-.3 38.8 38.8 0 01-5.5-2.7.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 42 42 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .4 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.3 47.3 47.3 0 003.6 5.9.2.2 0 00.3.1A58.7 58.7 0 0070.5 45.7v-.2c1.4-15-2.3-28.1-9.8-39.7a.2.2 0 00-.1 0zM23.7 37.3c-3.4 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.1 6.3 7-2.8 7-6.3 7zm23.2 0c-3.4 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.1 6.3 7-2.8 7-6.3 7z"/></svg>
      Connecte-toi
    </button>
  `;
  document.body.appendChild(bar);

  bar.querySelector('#guest-cta-bar-btn').addEventListener('click', async () => {
    const { openAuthModal } = await import('./auth.js');
    openAuthModal();
  });
}

function blurName(name) {
  if (!name || name.length <= 3) return '***';
  return escapeHtml(name.substring(0, 3)) + '***';
}

// ─── Helpers ──────────────────────────────────────────────────

function formatRank(tier, division) {
  if (!tier || tier === 'UNRANKED') return 'Unranked';
  const name = tier.charAt(0) + tier.slice(1).toLowerCase();
  if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)) return name;
  return name + ' ' + (division || '');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function getPlayerCount() {
  const { count, error } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });

  return error ? 0 : count;
}
