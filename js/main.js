import { supabase } from './supabase.js';
import { initAuthModal, openAuthModal, getDiscordInfo, logout } from './auth.js';
import { initRiotVerification } from './riot.js';
import { loadProfile, fillProfileForm, resetProfileForm, setDiscordInfo, initProfileForm } from './profile.js';
import { initBrowse, loadServers, loadServerDetail, getPlayerCount } from './browse.js';

import { initDashboard, updateDashboardProfile, restoreOwnProfile, isViewingOtherPlayer } from './dashboard.js';
import { joinServerByGuildId } from './servers.js';

// --- Toast system ---
const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);

window.showToast = function (message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
};

// --- State ---
let currentUser = null;
let currentProfileData = null;

// --- View management ---
function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.classList.add('hidden');
  });
  const view = document.getElementById(viewId);
  if (view) {
    view.classList.remove('hidden');
    view.classList.add('active');
  }
}

// --- Profile tabs ---
function initProfileTabs() {
  document.querySelectorAll('.profile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.profile-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(target)?.classList.add('active');
    });
  });
}

function showProfileTab(tabId) {
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.profile-tab-content').forEach(c => c.classList.remove('active'));
  const tab = document.querySelector(`.profile-tab[data-tab="${tabId}"]`);
  if (tab) tab.classList.add('active');
  document.getElementById(tabId)?.classList.add('active');
}

// Expose for dashboard.js
window._showView = showView;
window._showProfileTab = showProfileTab;

// --- Navbar ---
function updateNavbar(user) {
  const actions = document.getElementById('navbar-actions');

  if (user) {
    const discordInfo = getDiscordInfo(user);
    const avatarHtml = discordInfo?.discord_avatar
      ? `<img class="navbar-avatar" src="${discordInfo.discord_avatar}" alt="" />`
      : '';

    actions.innerHTML = `
      <div class="navbar-user">
        <button class="btn btn-ghost" id="nav-browse">Communautes</button>
        <button class="btn btn-ghost" id="nav-profile">Mon Profil</button>
        <button class="btn btn-ghost" id="nav-logout">
          ${avatarHtml}
          Deconnexion
        </button>
      </div>
    `;
    document.getElementById('nav-browse').addEventListener('click', () => {
      showView('view-browse');
      loadServers();
    });
    document.getElementById('nav-profile').addEventListener('click', () => {
      if (isViewingOtherPlayer()) {
        restoreOwnProfile();
      }
      showView('view-profile');
    });
    document.getElementById('nav-logout').addEventListener('click', async () => {
      await logout();
    });
  } else {
    actions.innerHTML = `
      <button class="btn btn-discord" id="btn-login">
        <svg width="18" height="14" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.3 37.3 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 4.9a.2.2 0 00-.1.1A60 60 0 00.4 45a.2.2 0 00.1.2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.6 38.6 0 01-5.5-2.6.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .3 36.3 36.3 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3.1A58.5 58.5 0 0070.1 45.2a.2.2 0 000-.2A59.7 59.7 0 0060.2 5a.2.2 0 00-.1 0zM23.7 36.9c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.2 6.3-7.2 6.4 3.2 6.3 7.2c0 3.9-2.8 7.1-6.3 7.1zm23.2 0c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.2 6.3-7.2 6.4 3.2 6.3 7.2c0 3.9-2.7 7.1-6.3 7.1z"/></svg>
        Se connecter
      </button>
    `;
    document.getElementById('btn-login').addEventListener('click', () => openAuthModal());
  }
}

// --- Handle auth state change ---
async function handleAuthChange(session) {
  if (session?.user) {
    currentUser = session.user;
    updateNavbar(session.user);

    // Check for pending server join (from ?server= URL)
    const pendingGuildId = sessionStorage.getItem('pendingServer');
    if (pendingGuildId) {
      sessionStorage.removeItem('pendingServer');
      const discordInfo = getDiscordInfo(session.user);
      setDiscordInfo(discordInfo);

      const profile = await loadProfile(session.user.id);
      currentProfileData = profile;

      initProfileForm(session.user.id, async () => {
        const updatedProfile = await loadProfile(session.user.id);
        currentProfileData = updatedProfile;
        if (updatedProfile) {
          initDashboard(session.user.id, updatedProfile, () => {
            showView('view-browse');
            initBrowse(session.user.id, updatedProfile);
          });
          updateDashboardProfile(updatedProfile);
        }
      });

      if (profile) {
        fillProfileForm(profile);
        initDashboard(session.user.id, profile, () => {
          showView('view-browse');
          initBrowse(session.user.id, profile);
        });
      }

      // Auto-join the server
      try {
        await joinServerByGuildId(pendingGuildId, session.user.id);
      } catch {
        // may already be a member, ignore
      }

      // Navigate to server detail
      showView('view-browse');
      initBrowse(session.user.id, profile);
      // Small delay to ensure browse is initialized before loading detail
      setTimeout(() => loadServerDetail(pendingGuildId), 100);
      return;
    }

    const discordInfo = getDiscordInfo(session.user);
    setDiscordInfo(discordInfo);

    const profile = await loadProfile(session.user.id);
    currentProfileData = profile;

    initProfileForm(session.user.id, async () => {
      const updatedProfile = await loadProfile(session.user.id);
      currentProfileData = updatedProfile;
      if (updatedProfile) {
        initDashboard(session.user.id, updatedProfile, () => {
          showView('view-browse');
          initBrowse(session.user.id, updatedProfile);
        });
        updateDashboardProfile(updatedProfile);
      }
    });

    if (profile) {
      fillProfileForm(profile);
      initDashboard(session.user.id, profile, () => {
        showView('view-browse');
        initBrowse(session.user.id, profile);
      });
      showView('view-profile');
      if (profile.analytics && profile.analytics.overview && profile.analytics.overview.totalGames > 0) {
        showProfileTab('tab-analyse');
      } else {
        showProfileTab('tab-form');
      }
    } else {
      resetProfileForm();
      showView('view-profile');
      showProfileTab('tab-form');
    }
  } else {
    currentUser = null;
    currentProfileData = null;
    updateNavbar(null);
    resetProfileForm();

    // If pending server and not logged in, prompt auth
    if (sessionStorage.getItem('pendingServer')) {
      openAuthModal();
      return;
    }

    showView('view-landing');
  }
}

// --- Main init ---
async function init() {
  // Detect ?server=GUILD_ID in URL
  const params = new URLSearchParams(location.search);
  const pendingServer = params.get('server');
  if (pendingServer) {
    sessionStorage.setItem('pendingServer', pendingServer);
    history.replaceState({}, '', location.pathname);
  }

  initAuthModal();
  initRiotVerification();
  initProfileTabs();

  // Hero buttons
  document.getElementById('hero-join').addEventListener('click', () => openAuthModal());
  document.getElementById('hero-browse').addEventListener('click', () => {
    showView('view-browse');
    initBrowse(null, null);
  });

  // Logo click
  document.querySelector('.navbar-brand').addEventListener('click', () => {
    if (currentUser) {
      if (isViewingOtherPlayer()) {
        restoreOwnProfile();
      }
      showView('view-profile');
    } else {
      showView('view-landing');
    }
  });

  // Player count
  try {
    const count = await getPlayerCount();
    document.getElementById('stat-players').textContent = count || '0';
  } catch {}

  // Auth state
  supabase.auth.onAuthStateChange(async (_event, session) => {
    await handleAuthChange(session);
  });
}

init();
