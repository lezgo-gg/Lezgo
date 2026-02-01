import { supabase } from './supabase.js';
import { initAuthModal, openAuthModal, getDiscordInfo, logout } from './auth.js';
import { initRiotVerification } from './riot.js';
import { loadProfile, fillProfileForm, resetProfileForm, setDiscordInfo, initProfileForm } from './profile.js';
import { initBrowse, loadServers, loadServerDetail, getPlayerCount } from './browse.js';
import { initDashboard, updateDashboardProfile, restoreOwnProfile, isViewingOtherPlayer } from './dashboard.js';
import { initOnboarding } from './onboarding.js';
import { initAdmin } from './admin.js';

// --- Constants ---
const ADMIN_DISCORD_ID = '713053980464513147';

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
let isAdmin = false;
let streamerTabLoaded = false;

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
    tab.addEventListener('click', async () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.profile-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(target)?.classList.add('active');

      // Lazy-load streamer tab
      if (target === 'tab-streamer' && !streamerTabLoaded && currentUser) {
        streamerTabLoaded = true;
        const discordInfo = getDiscordInfo(currentUser);
        const { initStreamerSection } = await import('./streamer-request.js');
        await initStreamerSection(currentUser, discordInfo);
      }
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

// --- Access check: is user member of a licensed server? ---
async function hasLicensedAccess(userId) {
  const { data, error } = await supabase
    .from('server_members')
    .select('server_id, servers!inner(licensed)')
    .eq('user_id', userId)
    .eq('servers.licensed', true)
    .limit(1);

  if (error) {
    console.error('License check error:', error);
    return false;
  }
  return data && data.length > 0;
}

// --- Navbar ---
function updateNavbar(user, showAdminBtn = false) {
  const actions = document.getElementById('navbar-actions');

  if (user) {
    const discordInfo = getDiscordInfo(user);
    const avatarHtml = discordInfo?.discord_avatar
      ? `<img class="navbar-avatar" src="${discordInfo.discord_avatar}" alt="" />`
      : '';

    const adminBtnHtml = showAdminBtn
      ? '<button class="btn btn-ghost admin-nav-btn" id="nav-admin">Admin</button>'
      : '';

    actions.innerHTML = `
      <div class="navbar-user">
        ${adminBtnHtml}
        <button class="btn btn-ghost" id="nav-browse">Communautés</button>
        <button class="btn btn-ghost" id="nav-profile">Mon Profil</button>
        <button class="btn btn-ghost" id="nav-logout">
          ${avatarHtml}
          Déconnexion
        </button>
      </div>
    `;

    if (showAdminBtn) {
      document.getElementById('nav-admin').addEventListener('click', () => {
        showView('view-admin');
        initAdmin();
      });
    }

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
    const discordInfo = getDiscordInfo(session.user);
    setDiscordInfo(discordInfo);

    const profile = await loadProfile(session.user.id);
    currentProfileData = profile;

    // Check admin status
    isAdmin = discordInfo?.discord_id === ADMIN_DISCORD_ID;
    updateNavbar(session.user, isAdmin);

    // --- Detect OAuth returns for streamer tab ---
    const urlParams = new URLSearchParams(location.search);
    const hasStreamerOAuth = urlParams.has('guilds') || urlParams.has('guilds_error') || urlParams.has('twitch_done') || urlParams.has('twitch_error');

    // --- Admin: full access, skip gate (unless ?test-gate or returning from OAuth) ---
    const testGate = urlParams.has('test-gate');
    if (isAdmin && !testGate && !hasStreamerOAuth) {
      await handleNormalAccess(session, profile, discordInfo);
      return;
    }

    // If returning from streamer OAuth, go to normal access → streamer tab
    if (hasStreamerOAuth) {
      // Check if admin or has access - if so, go to profile > streamer tab
      const hasAccess = isAdmin || await hasLicensedAccess(session.user.id);
      if (hasAccess) {
        await handleNormalAccess(session, profile, discordInfo, true);
        return;
      }
      // No access yet — still need gate, but streamer OAuth means they're in the flow
      // Show gate but also init streamer section in profile for when they get access
    }

    // --- Check for pending access token (from ?t= URL) ---
    const pendingToken = sessionStorage.getItem('lezgo_access_token');
    if (pendingToken) {
      sessionStorage.removeItem('lezgo_access_token');
      const { data: tokenServer } = await supabase
        .from('servers')
        .select('id, guild_id')
        .eq('access_token', pendingToken)
        .eq('licensed', true)
        .single();

      if (tokenServer) {
        await supabase.from('server_members').upsert(
          { server_id: tokenServer.id, user_id: session.user.id },
          { onConflict: 'server_id,user_id' }
        );
        await handleNormalAccess(session, profile, discordInfo);
        return;
      }
      // Token invalide → continuer le flow normal (gate)
    }

    // --- Streamer flow: skip gate if returning from streamer onboarding ---
    const pendingStreamerAction = sessionStorage.getItem('postLoginAction');
    if (pendingStreamerAction === 'streamer-tab') {
      await handleNormalAccess(session, profile, discordInfo, true);
      return;
    }

    // --- License gate check ---
    const hasAccess = testGate ? false : await hasLicensedAccess(session.user.id);
    if (!hasAccess) {
      showView('view-gate');
      initGateLogout();
      const { initGate } = await import('./gate.js');
      await initGate(session.user.id);
      if (testGate) history.replaceState({}, '', location.pathname);
      return;
    }

    // --- Normal access flow ---
    await handleNormalAccess(session, profile, discordInfo);

  } else {
    currentUser = null;
    currentProfileData = null;
    isAdmin = false;
    streamerTabLoaded = false;
    updateNavbar(null);
    resetProfileForm();

    // Check for guest Twitch callback (unauthenticated streamer onboarding)
    const urlParams = new URLSearchParams(location.search);
    const twitchGuest = urlParams.get('twitch_guest');
    if (twitchGuest) {
      history.replaceState({}, '', location.pathname);
      try {
        const twitchData = JSON.parse(atob(twitchGuest.replace(/-/g, '+').replace(/_/g, '/')));
        sessionStorage.setItem('lezgo_twitch_guest', JSON.stringify(twitchData));
      } catch (e) {
        console.error('[Main] Failed to parse twitch_guest data:', e);
      }
    }

    // If we have guest Twitch data, show the streamer pricing flow
    const guestTwitchData = sessionStorage.getItem('lezgo_twitch_guest');
    if (guestTwitchData) {
      showView('view-profile');
      showProfileTab('tab-streamer');
      const dashHeader = document.getElementById('dashboard-header');
      const profileTabs = document.querySelector('.profile-tabs');
      if (dashHeader) dashHeader.classList.add('hidden');
      if (profileTabs) profileTabs.classList.add('hidden');
      const { showGuestPricing } = await import('./streamer-request.js');
      if (showGuestPricing) showGuestPricing(JSON.parse(guestTwitchData));
      return;
    }

    // Check if a token is in session to activate login
    const hasToken = !!sessionStorage.getItem('lezgo_access_token');
    updateLandingForToken(hasToken);
    showView('view-landing');
  }
}

async function handleNormalAccess(session, profile, discordInfo, goToStreamerTab) {
  // --- Onboarding check: no profile or no riot_puuid (skip for streamer flow) ---
  if ((!profile || !profile.riot_puuid) && !goToStreamerTab) {
    showView('view-onboarding');
    initOnboarding(session.user.id, discordInfo, async () => {
      const updatedProfile = await loadProfile(session.user.id);
      currentProfileData = updatedProfile;
      fillProfileForm(updatedProfile);
      initProfileForm(session.user.id, async () => {
        const refreshed = await loadProfile(session.user.id);
        currentProfileData = refreshed;
        if (refreshed) {
          initDashboard(session.user.id, refreshed, () => {
            showView('view-browse');
            initBrowse(session.user.id, refreshed);
          });
          updateDashboardProfile(refreshed);
        }
      });
      if (updatedProfile) {
        initDashboard(session.user.id, updatedProfile, () => {
          showView('view-browse');
          initBrowse(session.user.id, updatedProfile);
        });
      }
      showView('view-browse');
      initBrowse(session.user.id, updatedProfile);

      // Guide tour after onboarding
      setTimeout(async () => {
        const { startTour, isTourDone } = await import('./guide.js');
        if (!isTourDone()) startTour();
        window.startTour = startTour;
      }, 600);
    });
    return;
  }

  // --- Standard profile init ---
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

  // --- Detect postLoginAction from sessionStorage ---
  const postAction = sessionStorage.getItem('postLoginAction');
  if (postAction === 'streamer-tab') {
    sessionStorage.removeItem('postLoginAction');
    goToStreamerTab = true;
  }

  // --- If returning from streamer OAuth or CTA, go to streamer tab ---
  if (goToStreamerTab) {
    showView('view-profile');
    showProfileTab('tab-streamer');
    // Trigger lazy-load
    if (!streamerTabLoaded && currentUser) {
      streamerTabLoaded = true;
      const { initStreamerSection } = await import('./streamer-request.js');
      await initStreamerSection(currentUser, discordInfo);
    }
    return;
  }

  // --- Default view ---
  if (profile) {
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

  // Expose startTour globally for replay via console
  import('./guide.js').then(({ startTour }) => {
    window.startTour = startTour;
  });
}

function updateLandingForToken(hasToken) {
  const heroJoin = document.getElementById('hero-join');
  const heroBrowse = document.getElementById('hero-browse');
  const banner = document.getElementById('token-gate-banner');
  const navbarLogin = document.getElementById('btn-login');

  if (hasToken) {
    if (heroJoin) heroJoin.classList.remove('hidden');
    if (heroBrowse) heroBrowse.classList.remove('hidden');
    if (banner) banner.classList.add('hidden');
    if (navbarLogin) navbarLogin.classList.remove('hidden');
  } else {
    if (heroJoin) heroJoin.classList.add('hidden');
    if (heroBrowse) heroBrowse.classList.add('hidden');
    if (banner) banner.classList.remove('hidden');
    if (navbarLogin) navbarLogin.classList.add('hidden');
  }
}

function initGateLogout() {
  const btn = document.getElementById('gate-logout');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      await logout();
    });
  }
}

// --- Main init ---
async function init() {
  // Token d'acces depuis le bot Discord
  const params = new URLSearchParams(location.search);
  const accessToken = params.get('t');
  if (accessToken) {
    sessionStorage.setItem('lezgo_access_token', accessToken);
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

  // Hero streamer CTA
  const streamerCta = document.getElementById('hero-streamer-cta');
  if (streamerCta) {
    streamerCta.addEventListener('click', () => {
      if (currentUser) {
        // Go to profile > streamer tab
        showView('view-profile');
        showProfileTab('tab-streamer');
        // Trigger lazy-load
        if (!streamerTabLoaded) {
          streamerTabLoaded = true;
          const discordInfo = getDiscordInfo(currentUser);
          import('./streamer-request.js').then(({ initStreamerSection }) => {
            initStreamerSection(currentUser, discordInfo);
          });
        }
      } else {
        // Show streamer tab directly without login
        showView('view-profile');
        showProfileTab('tab-streamer');
        // Hide profile header and tabs for unauthenticated streamer view
        const dashHeader = document.getElementById('dashboard-header');
        const profileTabs = document.querySelector('.profile-tabs');
        if (dashHeader) dashHeader.classList.add('hidden');
        if (profileTabs) profileTabs.classList.add('hidden');
        // Init the guest streamer flow
        import('./streamer-request.js').then(({ initGuestStreamerFlow }) => {
          if (initGuestStreamerFlow) initGuestStreamerFlow();
        });
      }
    });
  }

  // Demo video play/pause
  document.querySelectorAll('.pricing-demo-video').forEach(container => {
    const video = container.querySelector('video');
    const playBtn = container.querySelector('.pricing-demo-play');
    if (!video || !playBtn) return;
    playBtn.addEventListener('click', () => {
      if (video.paused) {
        video.play();
        container.classList.add('playing');
      } else {
        video.pause();
        container.classList.remove('playing');
      }
    });
    video.addEventListener('click', () => {
      video.pause();
      container.classList.remove('playing');
    });
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
