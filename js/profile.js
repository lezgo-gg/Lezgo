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
          <span style="color: var(--success); font-size: 0.85rem">&#10003; Vérifié</span>
        </div>
      `;
    } else {
      rankDisplay.innerHTML = `
        <div class="rank-verified">
          <span class="rank-${profile.rank_tier}">${rankLabel}</span>
          <span style="color: var(--text-muted); font-size: 0.85rem">(non vérifié)</span>
        </div>
      `;
    }
    rankDisplay.dataset.rank = profile.rank_tier;
    rankDisplay.dataset.division = profile.rank_division || '';

    if (profile.riot_puuid) {
      const resultDiv = document.getElementById('riot-verify-result');
      resultDiv.classList.remove('hidden', 'error');
      resultDiv.classList.add('success');
      resultDiv.textContent = `Compte vérifié : ${profile.riot_game_name}#${profile.riot_tag_line}`;
      resultDiv.dataset.puuid = profile.riot_puuid;
    }
  }
}

export function resetProfileForm() {
  document.getElementById('profile-form').reset();
  document.getElementById('rank-display').innerHTML =
    '<span class="rank-placeholder">Vérifie ton Riot ID pour afficher ton rank</span>';
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
      window.showToast('Tu dois être connecté', 'error');
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
      window.showToast('Sélectionne au moins un rôle', 'error');
      return;
    }
    if (schedule.length === 0) {
      window.showToast('Sélectionne au moins un horaire', 'error');
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

      window.showToast('Profil sauvegardé !', 'success');
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
      window.showToast('Compte supprimé. À bientôt.');
      const { supabase } = await import('./supabase.js');
      await supabase.auth.signOut();
      window.location.href = '/';
    } catch (err) {
      window.showToast('Erreur: ' + err.message, 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Supprimer définitivement';
    }
  });
}
