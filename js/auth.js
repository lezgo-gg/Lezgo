import { supabase } from './supabase.js';

let modalInitialized = false;

export function openAuthModal() {
  document.getElementById('modal-auth').classList.remove('hidden');
}

export function closeAuthModal() {
  document.getElementById('modal-auth').classList.add('hidden');
}

export function initAuthModal() {
  if (modalInitialized) return;
  modalInitialized = true;

  const modal = document.getElementById('modal-auth');
  const backdrop = modal.querySelector('.modal-backdrop');
  const closeBtn = document.getElementById('modal-auth-close');
  const discordBtn = document.getElementById('btn-discord-login');

  closeBtn.addEventListener('click', closeAuthModal);
  backdrop.addEventListener('click', closeAuthModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeAuthModal();
    }
  });

  discordBtn.addEventListener('click', loginWithDiscord);
}

async function loginWithDiscord() {
  const btn = document.getElementById('btn-discord-login');
  btn.disabled = true;
  btn.textContent = 'Redirection vers Discord...';

  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: window.location.origin + '/',
      },
    });

    if (error) throw error;
  } catch (err) {
    window.showToast('Erreur: ' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = `<svg width="20" height="15" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.3 37.3 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 4.9a.2.2 0 00-.1.1A60 60 0 00.4 45a.2.2 0 00.1.2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.6 38.6 0 01-5.5-2.6.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .3 36.3 36.3 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3.1A58.5 58.5 0 0070.1 45.2a.2.2 0 000-.2A59.7 59.7 0 0060.2 5a.2.2 0 00-.1 0zM23.7 36.9c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.2 6.3-7.2 6.4 3.2 6.3 7.2c0 3.9-2.8 7.1-6.3 7.1zm23.2 0c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.2 6.3-7.2 6.4 3.2 6.3 7.2c0 3.9-2.7 7.1-6.3 7.1z"/></svg> Se connecter avec Discord`;
  }
}

export function getDiscordInfo(user) {
  if (!user) return null;

  const meta = user.user_metadata || {};
  const identity = (user.identities || []).find(i => i.provider === 'discord');
  const identityData = identity?.identity_data || {};

  return {
    discord_id: meta.provider_id || identityData.provider_id || null,
    discord_username: meta.full_name || meta.name || identityData.full_name || identityData.name || null,
    discord_avatar: meta.avatar_url || identityData.avatar_url || null,
  };
}

export async function logout() {
  await supabase.auth.signOut();
}
