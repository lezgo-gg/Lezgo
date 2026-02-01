import { supabase } from './supabase.js';

const PAYPAL_USERNAME = import.meta.env.VITE_PAYPAL_USERNAME || 'RomainJahier';
const BOT_CLIENT_ID = import.meta.env.VITE_BOT_CLIENT_ID || '';
const BOT_PERMISSIONS = import.meta.env.VITE_BOT_PERMISSIONS || '0';

async function getAuthToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

async function authFetch(url, options = {}) {
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

function hideAllGateStates() {
  const ids = [
    'gate-default', 'gate-form',
    'gate-status-twitch', 'gate-status-pricing',
    'gate-status-payment',
    'gate-status-active', 'gate-status-rejected',
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function showGateState(stateId) {
  hideAllGateStates();
  const el = document.getElementById(stateId);
  if (el) el.classList.remove('hidden');
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function renderStatus(request) {
  if (!request) {
    showGateState('gate-default');
    return;
  }

  switch (request.status) {
    case 'pending': {
      if (!request.twitch_id) {
        // Sub-state: Twitch not connected yet
        showGateState('gate-status-twitch');
        const connectBtn = document.getElementById('gate-twitch-connect');
        if (connectBtn) {
          connectBtn.onclick = async () => {
            connectBtn.disabled = true;
            connectBtn.textContent = 'Redirection...';
            try {
              const data = await authFetch('/api/twitch/auth', {
                method: 'POST',
                body: JSON.stringify({ request_id: request.id }),
              });
              if (data.url) {
                window.location.href = data.url;
              }
            } catch (err) {
              window.showToast('Erreur: ' + err.message, 'error');
              connectBtn.disabled = false;
              connectBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg> Connecter Twitch';
            }
          };
        }
      } else {
        // Sub-state: Twitch connected, show pricing
        showGateState('gate-status-pricing');

        const surDevis = document.getElementById('gate-sur-devis');
        const pricingCard = document.querySelector('.gate-pricing-card');

        if (request.license_price === null) {
          // 500K+ followers: sur devis
          if (pricingCard) pricingCard.classList.add('hidden');
          if (surDevis) surDevis.classList.remove('hidden');
        } else {
          if (pricingCard) pricingCard.classList.remove('hidden');
          if (surDevis) surDevis.classList.add('hidden');

          // Fill Twitch profile
          const avatar = document.getElementById('gate-twitch-avatar');
          if (avatar) avatar.src = request.twitch_avatar || '';

          const name = document.getElementById('gate-twitch-name');
          if (name) name.textContent = request.twitch_display_name || request.twitch_username || '';

          const type = document.getElementById('gate-twitch-type');
          if (type) {
            const typeLabel = request.twitch_broadcaster_type === 'partner' ? 'Partner'
              : request.twitch_broadcaster_type === 'affiliate' ? 'Affiliate'
              : 'Streamer';
            type.textContent = typeLabel;
          }

          // Fill stats
          const followers = document.getElementById('gate-stat-followers');
          if (followers) followers.textContent = formatNumber(request.twitch_followers || 0);

          const viewers = document.getElementById('gate-stat-viewers');
          if (viewers) viewers.textContent = formatNumber(request.twitch_avg_viewers || 0);

          // Fill price
          const priceEl = document.getElementById('gate-price-amount');
          if (priceEl) priceEl.textContent = request.license_price;

          // Dynamic PayPal link
          const paypalLink = document.getElementById('gate-paypal-link');
          if (paypalLink) {
            paypalLink.href = `https://paypal.me/${PAYPAL_USERNAME}/${request.license_price}`;
          }
        }
      }
      break;
    }

    case 'payment_received':
      showGateState('gate-status-payment');
      break;

    case 'active': {
      showGateState('gate-status-active');
      const botInvite = document.getElementById('gate-bot-invite');
      if (botInvite && BOT_CLIENT_ID) {
        const guildId = request.guild_id || '';
        botInvite.href = `https://discord.com/api/oauth2/authorize?client_id=${BOT_CLIENT_ID}&permissions=${BOT_PERMISSIONS}&scope=bot%20applications.commands&guild_id=${guildId}`;
      }
      break;
    }

    case 'rejected': {
      showGateState('gate-status-rejected');
      const reason = document.getElementById('gate-reject-reason');
      if (reason) {
        reason.textContent = request.admin_note || 'Aucune raison specifiee.';
      }
      break;
    }

    default:
      showGateState('gate-default');
  }
}

function bindGateEvents(user, discordInfo) {
  // "Devenir partenaire" button
  const partnerBtn = document.getElementById('gate-become-partner');
  if (partnerBtn && !partnerBtn.dataset.bound) {
    partnerBtn.dataset.bound = '1';
    partnerBtn.addEventListener('click', () => {
      showGateState('gate-form');
    });
  }

  // Cancel form
  const cancelBtn = document.getElementById('gate-cancel-form');
  if (cancelBtn && !cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = '1';
    cancelBtn.addEventListener('click', () => {
      showGateState('gate-default');
    });
  }

  // Submit form
  const form = document.getElementById('gate-request-form');
  if (form && !form.dataset.bound) {
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const guild_id = document.getElementById('gate-guild-id').value.trim();
      const guild_name = document.getElementById('gate-guild-name').value.trim();
      const guild_icon = document.getElementById('gate-guild-icon').value.trim();

      if (!guild_id || !guild_name) {
        window.showToast('Guild ID et nom requis', 'error');
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Envoi...';

      try {
        const request = await authFetch('/api/request-license', {
          method: 'POST',
          body: JSON.stringify({ guild_id, guild_name, guild_icon: guild_icon || null }),
        });
        window.showToast('Demande envoyee !');
        renderStatus(request);
      } catch (err) {
        window.showToast('Erreur: ' + err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Envoyer la demande';
      }
    });
  }

  // Resubmit button (from rejected state)
  const resubmitBtn = document.getElementById('gate-resubmit');
  if (resubmitBtn && !resubmitBtn.dataset.bound) {
    resubmitBtn.dataset.bound = '1';
    resubmitBtn.addEventListener('click', () => {
      showGateState('gate-form');
    });
  }

  // Access app button (from active state)
  const accessBtn = document.getElementById('gate-access-app');
  if (accessBtn && !accessBtn.dataset.bound) {
    accessBtn.dataset.bound = '1';
    accessBtn.addEventListener('click', () => {
      window.location.reload();
    });
  }
}

export async function initGateRequestStatus(user, discordInfo) {
  bindGateEvents(user, discordInfo);

  // Detect ?twitch_done=1 to force reload
  const params = new URLSearchParams(window.location.search);
  if (params.get('twitch_done') === '1' || params.get('twitch_error')) {
    if (params.get('twitch_error')) {
      window.showToast('Erreur Twitch: ' + params.get('twitch_error'), 'error');
    }
    history.replaceState({}, '', window.location.pathname);
  }

  try {
    const requests = await authFetch('/api/my-requests');

    // Find the most relevant request (latest non-rejected, or latest rejected)
    const activeOrPending = requests.find(r =>
      r.status === 'active' || r.status === 'payment_received' || r.status === 'pending'
    );
    const latest = activeOrPending || requests[0] || null;

    renderStatus(latest);
  } catch (err) {
    console.error('[Gate] Failed to load requests:', err.message);
    showGateState('gate-default');
  }
}
