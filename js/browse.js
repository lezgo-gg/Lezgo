import { supabase } from './supabase.js';
import {
  loadAllServers,
  joinServerByGuildId,
  leaveServer,
  createLfgPost,
  getActiveLfgPosts,
  deleteLfgPost,
} from './servers.js';

let currentUserId = null;
let currentUserProfile = null;
let serverDetailInitialized = false;
let currentServerData = null;

// ─── Public API ───────────────────────────────────────────────

export function initBrowse(userId, myProfile) {
  currentUserId = userId;
  currentUserProfile = myProfile || null;

  if (!serverDetailInitialized) {
    serverDetailInitialized = true;
    initServerDetailUI();
  }

  loadServers();
}

export { getPlayerCount };

// ─── Server list ──────────────────────────────────────────────

export async function loadServers() {
  showSubView('browse-servers');
  const grid = document.getElementById('servers-grid');
  grid.innerHTML = '<div class="loading-state">Chargement des communautes...</div>';

  try {
    const servers = await loadAllServers();
    renderServers(servers);
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">Erreur: ${escapeHtml(err.message)}</div>`;
  }
}

function renderServers(servers) {
  const grid = document.getElementById('servers-grid');

  if (servers.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <p>Aucune communaute pour le moment.</p>
        <p style="margin-top:0.5rem;color:var(--text-muted)">Invite le bot LFG sur ton serveur Discord pour commencer !</p>
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

  updateJoinLeaveButtons(server.id);
  refreshLfgPosts(server.id);
}

async function updateJoinLeaveButtons(serverId) {
  const btnJoin = document.getElementById('btn-join-server');
  const btnLeave = document.getElementById('btn-leave-server');

  if (!currentUserId) {
    btnJoin.classList.remove('hidden');
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
    btnJoin.classList.add('hidden');
    btnLeave.classList.remove('hidden');
    document.getElementById('btn-create-lfg').classList.remove('hidden');
  } else {
    btnJoin.classList.remove('hidden');
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
      window.showToast('Tu as rejoint la communaute !');
      loadServerDetail(currentServerData.guild_id);
    } catch (err) {
      window.showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-leave-server').addEventListener('click', async () => {
    if (!currentServerData || !currentUserId) return;
    try {
      await leaveServer(currentServerData.id, currentUserId);
      window.showToast('Tu as quitte la communaute');
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
      window.showToast('Annonce LFG publiee !');
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
  try {
    const posts = await getActiveLfgPosts(serverId);
    renderLfgPosts(posts, container);
  } catch {
    container.innerHTML = '<p class="empty-note">Erreur de chargement LFG</p>';
  }
}

function renderLfgPosts(posts, container) {
  if (posts.length === 0) {
    container.innerHTML = '<p class="empty-note">Aucune annonce LFG active. Sois le premier !</p>';
    return;
  }

  const roleMap = { TOP: 'TOP', JUNGLE: 'JGL', MID: 'MID', ADC: 'ADC', SUPPORT: 'SUP' };

  container.innerHTML = posts.map(post => {
    const profile = post.profiles || {};
    const avatarHtml = profile.discord_avatar
      ? `<img class="lfg-post-avatar" src="${escapeHtml(profile.discord_avatar)}" alt="" />`
      : `<div class="lfg-post-avatar lfg-post-avatar-placeholder"></div>`;

    const roleBadge = post.wanted_role
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

    const discordLink = profile.discord_id
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
            <span class="lfg-post-name">${escapeHtml(profile.riot_game_name || profile.discord_username || '?')}${profile.riot_tag_line ? '#' + escapeHtml(profile.riot_tag_line) : ''}</span>
            <div class="lfg-post-meta">${rankBadge} ${roleBadge}</div>
          </div>
        </div>
        ${post.note ? `<div class="lfg-post-note">${escapeHtml(post.note)}</div>` : ''}
        <div class="lfg-post-actions">
          <span class="lfg-post-timer" title="Expire a ${expiresAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}">${timerText}</span>
          ${discordLink}
          ${deleteBtn}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.lfg-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await deleteLfgPost(btn.dataset.lfgId);
        window.showToast('Annonce supprimee');
        if (currentServerData) refreshLfgPosts(currentServerData.id);
      } catch (err) {
        window.showToast(err.message, 'error');
      }
    });
  });
}

// ─── Sub-view toggle ──────────────────────────────────────────

function showSubView(id) {
  document.getElementById('browse-servers').classList.toggle('hidden', id !== 'browse-servers');
  document.getElementById('browse-server-detail').classList.toggle('hidden', id !== 'browse-server-detail');
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
