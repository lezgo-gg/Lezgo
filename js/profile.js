import { supabase } from './supabase.js';

let formInitialized = false;
let currentUserId = null;
let currentDiscordInfo = null;
let onSavedCallback = null;

async function getAuthToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

export async function loadProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error loading profile:', error);
  }

  return data;
}

export function setDiscordInfo(discordInfo) {
  currentDiscordInfo = discordInfo;

  const linkedDiv = document.getElementById('discord-linked');
  const avatarImg = document.getElementById('discord-avatar-preview');
  const nameSpan = document.getElementById('discord-linked-name');

  if (discordInfo && discordInfo.discord_username) {
    avatarImg.src = discordInfo.discord_avatar || '';
    avatarImg.alt = discordInfo.discord_username;
    nameSpan.textContent = discordInfo.discord_username;
    linkedDiv.style.display = '';
  } else {
    linkedDiv.style.display = 'none';
  }
}

export function fillProfileForm(profile) {
  if (!profile) return;

  document.getElementById('riot-name').value = profile.riot_game_name || '';
  document.getElementById('riot-tag').value = profile.riot_tag_line || '';

  document.querySelectorAll('input[name="roles"]').forEach(cb => {
    cb.checked = (profile.roles || []).includes(cb.value);
  });

  document.querySelectorAll('input[name="schedule"]').forEach(cb => {
    cb.checked = (profile.schedule || []).includes(cb.value);
  });

  const styleRadio = document.querySelector(`input[name="play_style"][value="${profile.play_style}"]`);
  if (styleRadio) styleRadio.checked = true;

  if (profile.rank_tier) {
    const rankDisplay = document.getElementById('rank-display');
    const rankLabel = getRankLabelSimple(profile.rank_tier, profile.rank_division);

    if (profile.verified) {
      rankDisplay.innerHTML = `
        <div class="rank-verified">
          <span class="rank-${profile.rank_tier}">${rankLabel}</span>
          <span style="color: var(--success); font-size: 0.85rem">&#10003; Verifie</span>
        </div>
      `;
    } else {
      rankDisplay.innerHTML = `
        <div class="rank-verified">
          <span class="rank-${profile.rank_tier}">${rankLabel}</span>
          <span style="color: var(--text-muted); font-size: 0.85rem">(non verifie)</span>
        </div>
      `;
    }
    rankDisplay.dataset.rank = profile.rank_tier;
    rankDisplay.dataset.division = profile.rank_division || '';

    if (profile.riot_puuid) {
      const resultDiv = document.getElementById('riot-verify-result');
      resultDiv.classList.remove('hidden', 'error');
      resultDiv.classList.add('success');
      resultDiv.textContent = `Compte verifie : ${profile.riot_game_name}#${profile.riot_tag_line}`;
      resultDiv.dataset.puuid = profile.riot_puuid;
    }
  }
}

export function resetProfileForm() {
  document.getElementById('profile-form').reset();
  document.getElementById('rank-display').innerHTML =
    '<span class="rank-placeholder">Verifie ton Riot ID pour afficher ton rank</span>';
  document.getElementById('rank-display').dataset.rank = '';
  document.getElementById('rank-display').dataset.division = '';
  const resultDiv = document.getElementById('riot-verify-result');
  resultDiv.classList.add('hidden');
  resultDiv.classList.remove('success', 'error');
  resultDiv.dataset.puuid = '';
}

function getRankLabelSimple(tier, division) {
  if (!tier || tier === 'UNRANKED') return 'Unranked';
  if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)) {
    return tier.charAt(0) + tier.slice(1).toLowerCase();
  }
  return tier.charAt(0) + tier.slice(1).toLowerCase() + ' ' + (division || '');
}

export function initProfileForm(userId, onSaved) {
  currentUserId = userId;
  onSavedCallback = onSaved;

  if (formInitialized) return;
  formInitialized = true;

  const form = document.getElementById('profile-form');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentUserId) {
      window.showToast('Tu dois etre connecte', 'error');
      return;
    }

    const gameName = document.getElementById('riot-name').value.trim();
    const tagLine = document.getElementById('riot-tag').value.trim();
    const rankDisplay = document.getElementById('rank-display');
    const verifyResult = document.getElementById('riot-verify-result');

    const roles = [...document.querySelectorAll('input[name="roles"]:checked')]
      .map(cb => cb.value);
    const schedule = [...document.querySelectorAll('input[name="schedule"]:checked')]
      .map(cb => cb.value);
    const style = document.querySelector('input[name="play_style"]:checked')?.value;

    if (!gameName || !tagLine) {
      window.showToast('Entre ton Riot ID', 'error');
      return;
    }
    if (roles.length === 0) {
      window.showToast('Selectionne au moins un role', 'error');
      return;
    }
    if (schedule.length === 0) {
      window.showToast('Selectionne au moins un horaire', 'error');
      return;
    }
    if (!style) {
      window.showToast('Choisis ton style de jeu', 'error');
      return;
    }

    const profileData = {
      id: currentUserId,
      riot_game_name: gameName,
      riot_tag_line: tagLine,
      riot_puuid: verifyResult.dataset.puuid || null,
      rank_tier: rankDisplay.dataset.rank || 'UNRANKED',
      rank_division: rankDisplay.dataset.division || null,
      roles,
      schedule,
      play_style: style,
      discord_id: currentDiscordInfo?.discord_id || null,
      discord_username: currentDiscordInfo?.discord_username || null,
      discord_avatar: currentDiscordInfo?.discord_avatar || null,
      verified: !!verifyResult.dataset.puuid,
      updated_at: new Date().toISOString(),
      summoner_level: null,
      profile_icon_id: null,
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sauvegarde...';

    try {
      const { error } = await supabase
        .from('profiles')
        .upsert(profileData);

      if (error) throw error;

      window.showToast('Profil sauvegarde !', 'success');
      if (onSavedCallback) onSavedCallback();
    } catch (err) {
      window.showToast('Erreur: ' + err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sauvegarder mon profil';
    }
  });

  // Account deletion
  initDeleteAccount();
}

let deleteInitialized = false;
function initDeleteAccount() {
  if (deleteInitialized) return;
  deleteInitialized = true;

  const deleteBtn = document.getElementById('btn-delete-account');
  const modal = document.getElementById('modal-delete-account');
  const closeBtn = document.getElementById('modal-delete-close');
  const cancelBtn = document.getElementById('btn-cancel-delete');
  const confirmBtn = document.getElementById('btn-confirm-delete');
  const input = document.getElementById('delete-confirm-input');
  const backdrop = modal?.querySelector('.modal-backdrop');

  if (!deleteBtn || !modal) return;

  function openModal() {
    modal.classList.remove('hidden');
    input.value = '';
    confirmBtn.disabled = true;
  }
  function closeModal() {
    modal.classList.add('hidden');
    input.value = '';
    confirmBtn.disabled = true;
  }

  deleteBtn.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);
  backdrop?.addEventListener('click', closeModal);

  input?.addEventListener('input', () => {
    confirmBtn.disabled = input.value.trim() !== 'SUPPRIMER';
  });

  confirmBtn?.addEventListener('click', async () => {
    if (input.value.trim() !== 'SUPPRIMER') return;

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Suppression...';

    try {
      const token = await getAuthToken();
      const res = await fetch('/api/my-account', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');

      closeModal();
      window.showToast('Compte supprime. A bientot.');
      // Sign out and redirect
      const { supabase } = await import('./supabase.js');
      await supabase.auth.signOut();
      window.location.href = '/';
    } catch (err) {
      window.showToast('Erreur: ' + err.message, 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Supprimer definitivement';
    }
  });
}

const PAYPAL_USERNAME = import.meta.env.VITE_PAYPAL_USERNAME || 'RomainJahier';

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function statusLabel(licensed, expiresAt) {
  if (!licensed) return { text: 'Inactive', cls: 'sub-status-inactive' };
  if (expiresAt && new Date(expiresAt) < new Date()) return { text: 'Expiree', cls: 'sub-status-expired' };
  if (expiresAt) {
    const days = Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
    if (days <= 7) return { text: `Expire dans ${days}j`, cls: 'sub-status-warning' };
  }
  return { text: 'Active', cls: 'sub-status-active' };
}

export async function loadStreamerSection() {
  const section = document.getElementById('streamer-section');
  if (!section) return;

  try {
    const token = await getAuthToken();
    if (!token) return;

    const res = await fetch('/api/my-subscription', {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return;

    const { subscription, history } = await res.json();
    if (!subscription) return;

    // Twitch profile
    const avatar = document.getElementById('streamer-twitch-avatar');
    if (avatar) avatar.src = subscription.twitch_avatar || '';

    const name = document.getElementById('streamer-twitch-name');
    if (name) name.textContent = subscription.twitch_display_name || subscription.twitch_username || '';

    const type = document.getElementById('streamer-twitch-type');
    if (type) {
      const label = subscription.twitch_broadcaster_type === 'partner' ? 'Twitch Partner'
        : subscription.twitch_broadcaster_type === 'affiliate' ? 'Twitch Affiliate'
        : 'Compte Twitch lie';
      type.textContent = label;
    }

    // Subscription details
    const server = subscription.server;
    const price = subscription.license_price;

    const status = statusLabel(server?.licensed, server?.license_expires_at);
    const statusEl = document.getElementById('sub-status');
    if (statusEl) {
      statusEl.textContent = status.text;
      statusEl.className = 'sub-value sub-status ' + status.cls;
    }

    const serverName = document.getElementById('sub-server-name');
    if (serverName) serverName.textContent = subscription.guild_name || '-';

    const priceEl = document.getElementById('sub-price');
    if (priceEl) priceEl.textContent = price ? `${price} EUR / mois` : '-';

    const startEl = document.getElementById('sub-start');
    if (startEl) startEl.textContent = formatDate(server?.license_started_at);

    const expiresEl = document.getElementById('sub-expires');
    if (expiresEl) expiresEl.textContent = formatDate(server?.license_expires_at);

    // Renew button
    const renewBtn = document.getElementById('sub-renew-btn');
    if (renewBtn && price) {
      renewBtn.href = `https://paypal.me/${PAYPAL_USERNAME}/${price}`;
    }

    // Edit server form
    bindEditServer(token, subscription);

    // Payment history
    renderHistory(history);

    // Show streamer warnings in delete zone
    const streamerWarn = document.getElementById('delete-streamer-warn');
    if (streamerWarn) streamerWarn.classList.remove('hidden');
    const confirmStreamer = document.getElementById('delete-confirm-streamer');
    if (confirmStreamer) confirmStreamer.classList.remove('hidden');

    section.classList.remove('hidden');
  } catch (err) {
    console.error('[Profile] Streamer section error:', err.message);
  }
}

function bindEditServer(token, subscription) {
  const editBtn = document.getElementById('sub-edit-server-btn');
  const editForm = document.getElementById('sub-edit-server');
  const saveBtn = document.getElementById('sub-save-server');
  const cancelBtn = document.getElementById('sub-cancel-server');
  if (!editBtn || editBtn.dataset.bound) return;
  editBtn.dataset.bound = '1';

  editBtn.addEventListener('click', () => {
    document.getElementById('sub-guild-id').value = subscription.guild_id || '';
    document.getElementById('sub-guild-name').value = subscription.guild_name || '';
    document.getElementById('sub-guild-icon').value = subscription.guild_icon || '';
    editForm.classList.remove('hidden');
    editBtn.classList.add('hidden');
  });

  cancelBtn.addEventListener('click', () => {
    editForm.classList.add('hidden');
    editBtn.classList.remove('hidden');
  });

  saveBtn.addEventListener('click', async () => {
    const guild_id = document.getElementById('sub-guild-id').value.trim();
    const guild_name = document.getElementById('sub-guild-name').value.trim();
    const guild_icon = document.getElementById('sub-guild-icon').value.trim();

    if (!guild_id || !guild_name) {
      window.showToast('Guild ID et nom requis', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Sauvegarde...';

    try {
      const res = await fetch('/api/my-subscription/server', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_id, guild_name, guild_icon: guild_icon || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');

      window.showToast('Serveur mis a jour !');
      document.getElementById('sub-server-name').textContent = guild_name;
      editForm.classList.add('hidden');
      editBtn.classList.remove('hidden');
    } catch (err) {
      window.showToast('Erreur: ' + err.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Sauvegarder';
    }
  });
}

function renderHistory(history) {
  const list = document.getElementById('sub-history-list');
  if (!list) return;

  if (!history || history.length === 0) {
    list.innerHTML = '<p class="sub-history-empty">Aucun historique</p>';
    return;
  }

  const statusMap = {
    pending: 'En attente',
    payment_received: 'Paiement recu',
    active: 'Active',
    rejected: 'Refusee',
  };

  list.innerHTML = history.map(r => `
    <div class="sub-history-item">
      <span class="sub-history-date">${formatDate(r.created_at)}</span>
      <span class="sub-history-server">${r.guild_name}</span>
      <span class="sub-history-price">${r.license_price ? r.license_price + ' EUR' : '-'}</span>
      <span class="sub-history-status sub-history-${r.status}">${statusMap[r.status] || r.status}</span>
    </div>
  `).join('');
}
