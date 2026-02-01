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

// --- Step visibility helpers ---

function hideAllStreamerSteps() {
  const ids = [
    'streamer-cta', 'streamer-flow', 'streamer-subscription',
    'streamer-form',
    'streamer-status-twitch', 'streamer-status-pricing',
    'streamer-status-payment',
    'streamer-status-select-server',
    'streamer-status-active', 'streamer-status-rejected',
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function showStreamerStep(stepId) {
  hideAllStreamerSteps();
  const el = document.getElementById(stepId);
  if (el) el.classList.remove('hidden');
  // Also show the flow container if showing a flow sub-step
  const flowSteps = [
    'streamer-form',
    'streamer-status-twitch', 'streamer-status-pricing',
    'streamer-status-payment',
    'streamer-status-select-server',
    'streamer-status-active', 'streamer-status-rejected',
  ];
  if (flowSteps.includes(stepId)) {
    const flow = document.getElementById('streamer-flow');
    if (flow) flow.classList.remove('hidden');
    // Hide sub-steps except the target
    flowSteps.forEach(id => {
      if (id !== stepId) {
        const sub = document.getElementById(id);
        if (sub) sub.classList.add('hidden');
      }
    });
  }
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function statusLabel(licensed, expiresAt) {
  if (!licensed) return { text: 'Inactive', cls: 'sub-status-inactive' };
  if (expiresAt && new Date(expiresAt) < new Date()) return { text: 'Expirée', cls: 'sub-status-expired' };
  if (expiresAt) {
    const days = Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
    if (days <= 7) return { text: `Expire dans ${days}j`, cls: 'sub-status-warning' };
  }
  return { text: 'Active', cls: 'sub-status-active' };
}

// --- Render request status (flow steps) ---

function renderStatus(request) {
  if (!request) {
    showStreamerStep('streamer-cta');
    return;
  }

  switch (request.status) {
    case 'pending': {
      if (!request.twitch_id) {
        showStreamerStep('streamer-status-twitch');
        const connectBtn = document.getElementById('streamer-twitch-connect');
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
        showStreamerStep('streamer-status-pricing');

        const surDevis = document.getElementById('streamer-sur-devis');
        const pricingCard = document.querySelector('#streamer-status-pricing .gate-pricing-card');

        if (request.license_price === null) {
          if (pricingCard) pricingCard.classList.add('hidden');
          if (surDevis) surDevis.classList.remove('hidden');
        } else {
          if (pricingCard) pricingCard.classList.remove('hidden');
          if (surDevis) surDevis.classList.add('hidden');

          const avatar = document.getElementById('streamer-twitch-avatar');
          if (avatar) avatar.src = request.twitch_avatar || '';

          const name = document.getElementById('streamer-twitch-name');
          if (name) name.textContent = request.twitch_display_name || request.twitch_username || '';

          const type = document.getElementById('streamer-twitch-type');
          if (type) {
            const typeLabel = request.twitch_broadcaster_type === 'partner' ? 'Partner'
              : request.twitch_broadcaster_type === 'affiliate' ? 'Affiliate'
              : 'Streamer';
            type.textContent = typeLabel;
          }

          const followers = document.getElementById('streamer-stat-followers');
          if (followers) followers.textContent = formatNumber(request.twitch_followers || 0);

          const viewers = document.getElementById('streamer-stat-viewers');
          if (viewers) viewers.textContent = formatNumber(request.twitch_avg_viewers || 0);

          const priceEl = document.getElementById('streamer-price-amount');
          if (priceEl) priceEl.textContent = request.license_price;

          const paypalLink = document.getElementById('streamer-paypal-link');
          if (paypalLink) {
            paypalLink.href = `https://paypal.me/${PAYPAL_USERNAME}/${request.license_price}`;
          }
        }
      }
      break;
    }

    case 'payment_received':
      showStreamerStep('streamer-status-payment');
      break;

    case 'active': {
      if (!request.guild_id) {
        // No server yet — show server selection step
        showStreamerStep('streamer-status-select-server');
        bindGuildSelectionAfterActivation(request);
      } else {
        // Server linked — show bot invite
        showStreamerStep('streamer-status-active');
        const botInvite = document.getElementById('streamer-bot-invite');
        if (botInvite && BOT_CLIENT_ID) {
          botInvite.href = `https://discord.com/api/oauth2/authorize?client_id=${BOT_CLIENT_ID}&permissions=${BOT_PERMISSIONS}&scope=bot%20applications.commands&guild_id=${request.guild_id}`;
        }
      }
      break;
    }

    case 'rejected': {
      showStreamerStep('streamer-status-rejected');
      const reason = document.getElementById('streamer-reject-reason');
      if (reason) {
        reason.textContent = request.admin_note || 'Aucune raison spécifiée.';
      }
      break;
    }

    default:
      showStreamerStep('streamer-cta');
  }
}

// --- Guild helpers ---

function guildIconUrl(guildId, iconHash) {
  if (!iconHash) return '';
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.png?size=64`;
}

function selectGuild(guild) {
  document.getElementById('streamer-guild-id').value = guild.id;
  document.getElementById('streamer-guild-name').value = guild.name;
  document.getElementById('streamer-guild-icon').value = guild.icon || '';

  const preview = document.getElementById('streamer-guild-selected');
  const icon = document.getElementById('streamer-selected-icon');
  const name = document.getElementById('streamer-selected-name');

  if (guild.icon) {
    icon.src = guildIconUrl(guild.id, guild.icon);
    icon.style.display = '';
  } else {
    icon.style.display = 'none';
  }
  name.textContent = guild.name;

  document.getElementById('streamer-guild-select').classList.add('hidden');
  document.getElementById('streamer-guild-picker').classList.add('hidden');
  preview.classList.remove('hidden');
  document.getElementById('streamer-submit-btn').disabled = false;
}

function renderGuildPicker(guilds) {
  const picker = document.getElementById('streamer-guild-picker');
  const list = document.getElementById('streamer-guild-list');

  if (guilds.length === 0) {
    list.innerHTML = '<p class="empty-note">Aucun serveur ou tu es admin. Vérifie tes permissions Discord.</p>';
    picker.classList.remove('hidden');
    document.getElementById('streamer-guild-select').classList.add('hidden');
    return;
  }

  list.innerHTML = guilds.map(g => {
    const iconSrc = g.icon ? guildIconUrl(g.id, g.icon) : '';
    const iconHtml = iconSrc
      ? `<img class="gate-guild-item-icon" src="${iconSrc}" alt="" />`
      : `<div class="gate-guild-item-icon gate-guild-item-placeholder"></div>`;
    return `
      <button type="button" class="gate-guild-item" data-guild='${JSON.stringify(g).replace(/'/g, '&#39;')}'>
        ${iconHtml}
        <span class="gate-guild-item-name">${g.name}</span>
      </button>
    `;
  }).join('');

  list.querySelectorAll('.gate-guild-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const guild = JSON.parse(btn.dataset.guild);
      selectGuild(guild);
    });
  });

  picker.classList.remove('hidden');
  document.getElementById('streamer-guild-select').classList.add('hidden');
}

// --- Post-activation guild selection ---

function bindGuildSelectionAfterActivation(request) {
  // Discord guilds OAuth button
  const guildsBtn = document.getElementById('streamer-post-discord-guilds');
  if (guildsBtn && !guildsBtn.dataset.bound) {
    guildsBtn.dataset.bound = '1';
    guildsBtn.addEventListener('click', async () => {
      guildsBtn.disabled = true;
      guildsBtn.textContent = 'Redirection...';
      try {
        const data = await authFetch('/api/discord/guilds-auth', { method: 'POST' });
        if (data.url) {
          window.location.href = data.url;
        }
      } catch (err) {
        window.showToast('Erreur: ' + err.message, 'error');
        guildsBtn.disabled = false;
        guildsBtn.textContent = 'Selectionner mon serveur';
      }
    });
  }
}

function renderPostActivationGuildPicker(guilds, request) {
  const picker = document.getElementById('streamer-post-guild-picker');
  const list = document.getElementById('streamer-post-guild-list');
  const selectDiv = document.getElementById('streamer-post-guild-select');

  if (guilds.length === 0) {
    list.innerHTML = '<p class="empty-note">Aucun serveur ou tu es admin. Verifie tes permissions Discord.</p>';
    picker.classList.remove('hidden');
    if (selectDiv) selectDiv.classList.add('hidden');
    return;
  }

  list.innerHTML = guilds.map(g => {
    const iconSrc = g.icon ? guildIconUrl(g.id, g.icon) : '';
    const iconHtml = iconSrc
      ? `<img class="gate-guild-item-icon" src="${iconSrc}" alt="" />`
      : `<div class="gate-guild-item-icon gate-guild-item-placeholder"></div>`;
    return `
      <button type="button" class="gate-guild-item" data-guild='${JSON.stringify(g).replace(/'/g, '&#39;')}'>
        ${iconHtml}
        <span class="gate-guild-item-name">${g.name}</span>
      </button>
    `;
  }).join('');

  list.querySelectorAll('.gate-guild-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const guild = JSON.parse(btn.dataset.guild);
      selectPostActivationGuild(guild, request);
    });
  });

  picker.classList.remove('hidden');
  if (selectDiv) selectDiv.classList.add('hidden');
}

function selectPostActivationGuild(guild, request) {
  const picker = document.getElementById('streamer-post-guild-picker');
  const selectedDiv = document.getElementById('streamer-post-guild-selected');
  const icon = document.getElementById('streamer-post-selected-icon');
  const name = document.getElementById('streamer-post-selected-name');

  if (guild.icon) {
    icon.src = guildIconUrl(guild.id, guild.icon);
    icon.style.display = '';
  } else {
    icon.style.display = 'none';
  }
  name.textContent = guild.name;

  if (picker) picker.classList.add('hidden');
  selectedDiv.classList.remove('hidden');

  // Bind confirm button
  const confirmBtn = document.getElementById('streamer-post-confirm-server');
  if (confirmBtn) {
    // Remove previous listeners by cloning
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

    newBtn.addEventListener('click', async () => {
      newBtn.disabled = true;
      newBtn.textContent = 'Confirmation...';
      try {
        await authFetch('/api/my-subscription/select-server', {
          method: 'POST',
          body: JSON.stringify({
            guild_id: guild.id,
            guild_name: guild.name,
            guild_icon: guild.icon || null,
          }),
        });
        window.showToast('Serveur lie avec succes !');
        // Refresh to show the bot invite / subscription
        window.location.reload();
      } catch (err) {
        window.showToast('Erreur: ' + err.message, 'error');
        newBtn.disabled = false;
        newBtn.textContent = 'Confirmer ce serveur';
      }
    });
  }
}

// --- Event bindings ---

function bindStreamerEvents(user, discordInfo) {
  // Start button (from CTA) — creates the request directly (no guild needed)
  const startBtn = document.getElementById('streamer-start-btn');
  if (startBtn && !startBtn.dataset.bound) {
    startBtn.dataset.bound = '1';
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      startBtn.textContent = 'Chargement...';
      try {
        const request = await authFetch('/api/request-license', { method: 'POST' });
        renderStatus(request);
      } catch (err) {
        window.showToast('Erreur: ' + err.message, 'error');
        startBtn.disabled = false;
        startBtn.textContent = 'Démarrer';
      }
    });
  }

  // Cancel form
  const cancelBtn = document.getElementById('streamer-cancel-form');
  if (cancelBtn && !cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = '1';
    cancelBtn.addEventListener('click', () => {
      document.getElementById('streamer-guild-select').classList.remove('hidden');
      document.getElementById('streamer-guild-picker').classList.add('hidden');
      document.getElementById('streamer-guild-selected').classList.add('hidden');
      document.getElementById('streamer-submit-btn').disabled = true;
      document.getElementById('streamer-guild-id').value = '';
      document.getElementById('streamer-guild-name').value = '';
      document.getElementById('streamer-guild-icon').value = '';
      showStreamerStep('streamer-cta');
    });
  }

  // Discord guilds OAuth button
  const guildsBtn = document.getElementById('streamer-discord-guilds');
  if (guildsBtn && !guildsBtn.dataset.bound) {
    guildsBtn.dataset.bound = '1';
    guildsBtn.addEventListener('click', async () => {
      guildsBtn.disabled = true;
      guildsBtn.textContent = 'Redirection...';
      try {
        const data = await authFetch('/api/discord/guilds-auth', { method: 'POST' });
        if (data.url) {
          window.location.href = data.url;
        }
      } catch (err) {
        window.showToast('Erreur: ' + err.message, 'error');
        guildsBtn.disabled = false;
        guildsBtn.innerHTML = '<svg width="20" height="15" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.3 37.3 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 4.9a.2.2 0 00-.1.1A60 60 0 00.4 45a.2.2 0 00.1.2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.6 38.6 0 01-5.5-2.6.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .3 36.3 36.3 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3.1A58.5 58.5 0 0070.1 45.2a.2.2 0 000-.2A59.7 59.7 0 0060.2 5a.2.2 0 00-.1 0zM23.7 36.9c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.2 6.3-7.2 6.4 3.2 6.3 7.2c0 3.9-2.8 7.1-6.3 7.1zm23.2 0c-3.5 0-6.3-3.2-6.3-7.1s2.8-7.2 6.3-7.2 6.4 3.2 6.3 7.2c0 3.9-2.7 7.1-6.3 7.1z"/></svg> Sélectionner mon serveur';
      }
    });
  }

  // Change guild button
  const changeBtn = document.getElementById('streamer-guild-change');
  if (changeBtn && !changeBtn.dataset.bound) {
    changeBtn.dataset.bound = '1';
    changeBtn.addEventListener('click', () => {
      document.getElementById('streamer-guild-selected').classList.add('hidden');
      document.getElementById('streamer-guild-select').classList.remove('hidden');
      document.getElementById('streamer-guild-picker').classList.add('hidden');
      document.getElementById('streamer-submit-btn').disabled = true;
      document.getElementById('streamer-guild-id').value = '';
      document.getElementById('streamer-guild-name').value = '';
      document.getElementById('streamer-guild-icon').value = '';
    });
  }

  // Submit form
  const form = document.getElementById('streamer-request-form');
  if (form && !form.dataset.bound) {
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const guild_id = document.getElementById('streamer-guild-id').value.trim();
      const guild_name = document.getElementById('streamer-guild-name').value.trim();
      const guild_icon = document.getElementById('streamer-guild-icon').value.trim();

      if (!guild_id || !guild_name) {
        window.showToast('Sélectionne un serveur', 'error');
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
        window.showToast('Demande envoyée !');
        renderStatus(request);
      } catch (err) {
        window.showToast('Erreur: ' + err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Envoyer la demande';
      }
    });
  }

  // Resubmit button (from rejected state)
  const resubmitBtn = document.getElementById('streamer-resubmit');
  if (resubmitBtn && !resubmitBtn.dataset.bound) {
    resubmitBtn.dataset.bound = '1';
    resubmitBtn.addEventListener('click', () => {
      showStreamerStep('streamer-form');
    });
  }

  // Access app button (from active state)
  const accessBtn = document.getElementById('streamer-access-app');
  if (accessBtn && !accessBtn.dataset.bound) {
    accessBtn.dataset.bound = '1';
    accessBtn.addEventListener('click', () => {
      window.location.reload();
    });
  }
}

// --- Subscription management (migrated from profile.js) ---

async function loadSubscriptionSection() {
  try {
    const token = await getAuthToken();
    if (!token) return false;

    const res = await fetch('/api/my-subscription', {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return false;

    const { subscription, history } = await res.json();
    if (!subscription) return false;

    // If active but no server linked yet, show server selection step
    if (!subscription.server && !subscription.server_id) {
      renderStatus(subscription);
      return true;
    }

    // Show subscription management state
    showStreamerStep('streamer-subscription');

    // Twitch profile
    const avatar = document.getElementById('streamer-sub-twitch-avatar');
    if (avatar) avatar.src = subscription.twitch_avatar || '';

    const name = document.getElementById('streamer-sub-twitch-name');
    if (name) name.textContent = subscription.twitch_display_name || subscription.twitch_username || '';

    const type = document.getElementById('streamer-sub-twitch-type');
    if (type) {
      const label = subscription.twitch_broadcaster_type === 'partner' ? 'Twitch Partner'
        : subscription.twitch_broadcaster_type === 'affiliate' ? 'Twitch Affiliate'
        : 'Compte Twitch lié';
      type.textContent = label;
    }

    // Subscription details
    const server = subscription.server;
    const price = subscription.license_price;

    const status = statusLabel(server?.licensed, server?.license_expires_at);
    const statusEl = document.getElementById('streamer-sub-status');
    if (statusEl) {
      statusEl.textContent = status.text;
      statusEl.className = 'sub-value sub-status ' + status.cls;
    }

    const serverName = document.getElementById('streamer-sub-server-name');
    if (serverName) serverName.textContent = subscription.guild_name || '-';

    const priceEl = document.getElementById('streamer-sub-price');
    if (priceEl) priceEl.textContent = price ? `${price} EUR / mois` : '-';

    const startEl = document.getElementById('streamer-sub-start');
    if (startEl) startEl.textContent = formatDate(server?.license_started_at);

    const expiresEl = document.getElementById('streamer-sub-expires');
    if (expiresEl) expiresEl.textContent = formatDate(server?.license_expires_at);

    // Renew button
    const renewBtn = document.getElementById('streamer-sub-renew-btn');
    if (renewBtn && price) {
      renewBtn.href = `https://paypal.me/${PAYPAL_USERNAME}/${price}`;
    }

    // Visibility toggle
    bindVisibilityToggle(token, server);

    // Edit server form
    bindEditServer(token, subscription);

    // Payment history
    renderHistory(history);

    // Show streamer warnings in delete zone
    const streamerWarn = document.getElementById('delete-streamer-warn');
    if (streamerWarn) streamerWarn.classList.remove('hidden');
    const confirmStreamer = document.getElementById('delete-confirm-streamer');
    if (confirmStreamer) confirmStreamer.classList.remove('hidden');

    // Load tournament management if subscription has a server
    if (subscription.server_id) {
      try {
        const { initTournamentManagement } = await import('./tournaments.js');
        await initTournamentManagement(subscription.server_id);
      } catch (err) {
        console.error('[Streamer] Tournament management error:', err.message);
      }
    }

    return true;
  } catch (err) {
    console.error('[Streamer] Subscription section error:', err.message);
    return false;
  }
}

function bindVisibilityToggle(token, server) {
  const toggle = document.getElementById('streamer-visibility-toggle');
  const label = document.getElementById('streamer-visibility-label');
  if (!toggle || toggle.dataset.bound) return;
  toggle.dataset.bound = '1';

  // Set initial state
  const isPublic = server?.public !== false;
  toggle.checked = isPublic;
  if (label) label.textContent = isPublic ? 'Public' : 'Privé';

  toggle.addEventListener('change', async () => {
    const newValue = toggle.checked;
    if (label) label.textContent = newValue ? 'Public' : 'Privé';

    try {
      await fetch('/api/my-subscription/visibility', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ public: newValue }),
      });
      window.showToast(newValue ? 'Serveur public' : 'Serveur privé');
    } catch (err) {
      // Revert on error
      toggle.checked = !newValue;
      if (label) label.textContent = !newValue ? 'Public' : 'Privé';
      window.showToast('Erreur: ' + err.message, 'error');
    }
  });
}

function bindEditServer(token, subscription) {
  const editBtn = document.getElementById('streamer-sub-edit-server-btn');
  const editForm = document.getElementById('streamer-sub-edit-server');
  const saveBtn = document.getElementById('streamer-sub-save-server');
  const cancelBtn = document.getElementById('streamer-sub-cancel-server');
  if (!editBtn || editBtn.dataset.bound) return;
  editBtn.dataset.bound = '1';

  editBtn.addEventListener('click', () => {
    document.getElementById('streamer-sub-guild-id').value = subscription.guild_id || '';
    document.getElementById('streamer-sub-guild-name').value = subscription.guild_name || '';
    document.getElementById('streamer-sub-guild-icon').value = subscription.guild_icon || '';
    editForm.classList.remove('hidden');
    editBtn.classList.add('hidden');
  });

  cancelBtn.addEventListener('click', () => {
    editForm.classList.add('hidden');
    editBtn.classList.remove('hidden');
  });

  saveBtn.addEventListener('click', async () => {
    const guild_id = document.getElementById('streamer-sub-guild-id').value.trim();
    const guild_name = document.getElementById('streamer-sub-guild-name').value.trim();
    const guild_icon = document.getElementById('streamer-sub-guild-icon').value.trim();

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

      window.showToast('Serveur mis à jour !');
      document.getElementById('streamer-sub-server-name').textContent = guild_name;
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
  const list = document.getElementById('streamer-sub-history-list');
  if (!list) return;

  if (!history || history.length === 0) {
    list.innerHTML = '<p class="sub-history-empty">Aucun historique</p>';
    return;
  }

  const statusMap = {
    pending: 'En attente',
    payment_received: 'Paiement reçu',
    active: 'Active',
    rejected: 'Refusée',
  };

  list.innerHTML = history.map(r => `
    <div class="sub-history-item">
      <span class="sub-history-date">${formatDate(r.created_at)}</span>
      <span class="sub-history-server">${r.guild_name || '-'}</span>
      <span class="sub-history-price">${r.license_price ? r.license_price + ' EUR' : '-'}</span>
      <span class="sub-history-status sub-history-${r.status}">${statusMap[r.status] || r.status}</span>
    </div>
  `).join('');
}

// --- Main entry point ---

export async function initStreamerSection(user, discordInfo) {
  bindStreamerEvents(user, discordInfo);

  // Check if returning from guest Twitch flow (user just logged in with Discord)
  const guestTwitchRaw = sessionStorage.getItem('lezgo_twitch_guest');
  if (guestTwitchRaw) {
    sessionStorage.removeItem('lezgo_twitch_guest');
    try {
      const twitchData = JSON.parse(guestTwitchRaw);
      // Create the request
      const request = await authFetch('/api/request-license', { method: 'POST' });
      // Update it with Twitch data via the Twitch auth flow
      // Since the request is pending and has no twitch_id, we need to connect Twitch
      // But we already have the data — let's show pricing directly and store data
      // We'll use a dedicated endpoint to attach Twitch data
      await authFetch('/api/my-requests/' + request.id + '/twitch', {
        method: 'PUT',
        body: JSON.stringify(twitchData),
      });
      // Reload the request to get updated data
      const requests = await authFetch('/api/my-requests');
      const updated = requests.find(r => r.id === request.id) || request;
      renderStatus({ ...updated, ...twitchData });
      return;
    } catch (err) {
      console.error('[Streamer] Guest Twitch → request error:', err.message);
      // Fall through to normal flow
    }
  }

  // Handle OAuth callback params
  const params = new URLSearchParams(window.location.search);

  const guildsParam = params.get('guilds');
  if (guildsParam) {
    history.replaceState({}, '', window.location.pathname);
    try {
      const guilds = JSON.parse(atob(guildsParam.replace(/-/g, '+').replace(/_/g, '/')));

      // Check if user has an active license without guild (post-activation flow)
      let isPostActivation = false;
      try {
        const requests = await authFetch('/api/my-requests');
        const activeNoGuild = requests.find(r => r.status === 'active' && !r.guild_id);
        if (activeNoGuild) {
          isPostActivation = true;
          showStreamerStep('streamer-status-select-server');
          bindGuildSelectionAfterActivation(activeNoGuild);
          renderPostActivationGuildPicker(guilds, activeNoGuild);
        }
      } catch (e) {
        // Ignore — fall through to old flow
      }

      if (isPostActivation) {
        return; // Post-activation guild selection is already displayed
      }

      showStreamerStep('streamer-form');
      renderGuildPicker(guilds);
    } catch (err) {
      window.showToast('Erreur de décodage des serveurs', 'error');
    }
  }

  if (params.get('guilds_error')) {
    window.showToast('Erreur Discord: ' + params.get('guilds_error'), 'error');
    history.replaceState({}, '', window.location.pathname);
  }

  if (params.get('twitch_done') === '1' || params.get('twitch_error')) {
    if (params.get('twitch_error')) {
      window.showToast('Erreur Twitch: ' + params.get('twitch_error'), 'error');
    }
    history.replaceState({}, '', window.location.pathname);
  }

  // Try loading active subscription first
  const hasSub = await loadSubscriptionSection();
  if (hasSub) return;

  // Otherwise load request status
  if (!guildsParam) {
    try {
      const requests = await authFetch('/api/my-requests');
      const activeOrPending = requests.find(r =>
        r.status === 'active' || r.status === 'payment_received' || r.status === 'pending'
      );
      const latest = activeOrPending || requests[0] || null;
      renderStatus(latest);
    } catch (err) {
      console.error('[Streamer] Failed to load requests:', err.message);
      showStreamerStep('streamer-cta');
    }
  }
}

// --- Guest streamer flow (unauthenticated) ---

export function initGuestStreamerFlow() {
  // "Demarrer" → go directly to Twitch connect (no login)
  const startBtn = document.getElementById('streamer-start-btn');
  if (startBtn && !startBtn.dataset.boundGuest) {
    startBtn.dataset.boundGuest = '1';
    startBtn.addEventListener('click', () => {
      showStreamerStep('streamer-status-twitch');
      bindGuestTwitchConnect();
    });
  }
}

function bindGuestTwitchConnect() {
  const connectBtn = document.getElementById('streamer-twitch-connect');
  if (connectBtn) {
    connectBtn.onclick = async () => {
      connectBtn.disabled = true;
      connectBtn.textContent = 'Redirection...';
      try {
        const res = await fetch('/api/twitch/auth-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error('Le serveur backend ne repond pas. Verifie qu\'il est bien demarre (port 3001).');
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur');
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
}

export function showGuestPricing(twitchData) {
  showStreamerStep('streamer-status-pricing');

  const surDevis = document.getElementById('streamer-sur-devis');
  const pricingCard = document.querySelector('#streamer-status-pricing .gate-pricing-card');

  if (twitchData.license_price === null) {
    if (pricingCard) pricingCard.classList.add('hidden');
    if (surDevis) surDevis.classList.remove('hidden');
  } else {
    if (pricingCard) pricingCard.classList.remove('hidden');
    if (surDevis) surDevis.classList.add('hidden');

    const avatar = document.getElementById('streamer-twitch-avatar');
    if (avatar) avatar.src = twitchData.twitch_avatar || '';

    const name = document.getElementById('streamer-twitch-name');
    if (name) name.textContent = twitchData.twitch_display_name || twitchData.twitch_username || '';

    const type = document.getElementById('streamer-twitch-type');
    if (type) {
      const typeLabel = twitchData.twitch_broadcaster_type === 'partner' ? 'Partner'
        : twitchData.twitch_broadcaster_type === 'affiliate' ? 'Affiliate'
        : 'Streamer';
      type.textContent = typeLabel;
    }

    const followers = document.getElementById('streamer-stat-followers');
    if (followers) followers.textContent = formatNumber(twitchData.twitch_followers || 0);

    const viewers = document.getElementById('streamer-stat-viewers');
    if (viewers) viewers.textContent = formatNumber(twitchData.twitch_avg_viewers || 0);

    const priceEl = document.getElementById('streamer-price-amount');
    if (priceEl) priceEl.textContent = twitchData.license_price;

    // PayPal link: require Discord login first
    const paypalLink = document.getElementById('streamer-paypal-link');
    if (paypalLink) {
      paypalLink.href = '#';
      paypalLink.target = '';
      paypalLink.addEventListener('click', async (e) => {
        e.preventDefault();
        // Store Twitch data and trigger Discord login
        sessionStorage.setItem('lezgo_twitch_guest', JSON.stringify(twitchData));
        sessionStorage.setItem('postLoginAction', 'streamer-tab');
        // Import and call openAuthModal
        const { openAuthModal } = await import('./auth.js');
        openAuthModal();
      });
    }
  }
}

