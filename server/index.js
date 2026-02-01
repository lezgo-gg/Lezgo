import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.RIOT_API_KEY;

// --- Twitch OAuth config ---
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const TWITCH_REDIRECT_URI = process.env.TWITCH_REDIRECT_URI;

// --- Discord OAuth config (guilds selection) ---
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;

if (!API_KEY) {
  console.error('[API] RIOT_API_KEY manquant dans .env');
  process.exit(1);
}

// --- Supabase (service role for admin writes) ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_DISCORD_ID = '713053980464513147';

let supabaseAdmin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  console.log('[Admin] Supabase service role client initialized');
} else {
  console.warn('[Admin] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing - admin routes disabled');
}

app.use(express.json());

// --- Rate limiter (dev key: 20 req/sec, 100 req/2min) ---
const rateLimiter = {
  requests: [],
  canRequest() {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < 120000);
    const lastSecond = this.requests.filter(t => now - t < 1000);
    return lastSecond.length < 20 && this.requests.length < 100;
  },
  record() {
    this.requests.push(Date.now());
  },
  async wait() {
    while (!this.canRequest()) {
      await new Promise(r => setTimeout(r, 100));
    }
    this.record();
  }
};

async function riotFetch(url) {
  await rateLimiter.wait();
  return fetch(url, { headers: { 'X-Riot-Token': API_KEY } });
}

// =====================================================
// AUTH MIDDLEWARE - verify JWT (any logged-in user)
// =====================================================
async function requireAuth(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Service not configured' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = authHeader.slice(7);

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('[Auth] Error:', err.message);
    return res.status(500).json({ error: 'Erreur authentification' });
  }
}

// =====================================================
// ADMIN MIDDLEWARE - verify JWT and admin discord_id
// =====================================================
async function requireAdmin(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Admin service not configured' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = authHeader.slice(7);

  try {
    // Decode the JWT to get user_id
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    // Fetch profile to get discord_id
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('discord_id')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile) {
      // Fallback: check user_metadata from Discord OAuth
      const discordId = user.user_metadata?.provider_id;
      if (discordId !== ADMIN_DISCORD_ID) {
        return res.status(403).json({ error: 'Accès refusé' });
      }
    } else if (profile.discord_id !== ADMIN_DISCORD_ID) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    req.adminUser = user;
    next();
  } catch (err) {
    console.error('[Admin] Auth error:', err.message);
    return res.status(500).json({ error: 'Erreur authentification' });
  }
}

// =====================================================
// ADMIN ROUTES
// =====================================================

// GET /api/admin/stats - Global stats
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    // Total players
    const { count: totalPlayers } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    // Licensed servers
    const { count: licensedServers } = await supabaseAdmin
      .from('servers')
      .select('*', { count: 'exact', head: true })
      .eq('licensed', true);

    // Active players (last_analyzed_at < 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: activePlayers } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gt('last_analyzed_at', sevenDaysAgo);

    res.json({
      totalPlayers: totalPlayers || 0,
      licensedServers: licensedServers || 0,
      activePlayers: activePlayers || 0,
    });
  } catch (err) {
    console.error('[Admin] Stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/servers - List all servers with license info
app.get('/api/admin/servers', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('servers')
      .select('*')
      .order('member_count', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[Admin] Servers list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/servers - Add a server manually
app.post('/api/admin/servers', requireAdmin, async (req, res) => {
  try {
    const { guild_id, guild_name, guild_icon } = req.body;
    const isPublic = req.body.public;
    if (!guild_id || !guild_name) {
      return res.status(400).json({ error: 'guild_id et guild_name requis' });
    }

    const upsertData = {
      guild_id,
      guild_name,
      guild_icon: guild_icon || null,
    };
    if (typeof isPublic === 'boolean') {
      upsertData.public = isPublic;
    }

    const { data, error } = await supabaseAdmin
      .from('servers')
      .upsert(upsertData, { onConflict: 'guild_id' })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[Admin] Add server error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/license - Toggle license on/off
app.post('/api/admin/license', requireAdmin, async (req, res) => {
  try {
    const { server_id, licensed, license_label, license_price, license_started_at, license_expires_at } = req.body;
    const isPublic = req.body.public;

    if (!server_id) {
      return res.status(400).json({ error: 'server_id requis' });
    }

    const updateData = { licensed: !!licensed };
    if (licensed) {
      updateData.license_label = license_label || null;
      updateData.license_price = license_price != null ? license_price : null;
      updateData.license_started_at = license_started_at || new Date().toISOString();
      updateData.license_expires_at = license_expires_at || null;
    } else {
      // Keep the old data but set licensed to false
      updateData.licensed = false;
    }

    if (typeof isPublic === 'boolean') {
      updateData.public = isPublic;
    }

    const { data, error } = await supabaseAdmin
      .from('servers')
      .update(updateData)
      .eq('id', server_id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[Admin] License toggle error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// DISCORD GUILDS OAUTH (server selection)
// =====================================================

// POST /api/discord/guilds-auth - Returns Discord OAuth URL for guilds scope
app.post('/api/discord/guilds-auth', requireAuth, async (req, res) => {
  try {
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) {
      return res.status(500).json({ error: 'Discord OAuth non configure' });
    }

    const state = req.user.id;
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      response_type: 'code',
      redirect_uri: DISCORD_REDIRECT_URI,
      scope: 'guilds',
      state,
      prompt: 'none',
    });

    res.json({ url: `https://discord.com/oauth2/authorize?${params}` });
  } catch (err) {
    console.error('[Discord] Guilds auth error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/discord/guilds/callback - Discord OAuth callback, fetches admin guilds
app.get('/api/discord/guilds/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError || !code) {
      return res.redirect('/?guilds_error=' + encodeURIComponent(oauthError || 'no_code'));
    }

    // Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('[Discord] Token exchange failed:', err);
      return res.redirect('/?guilds_error=token_failed');
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Fetch user's guilds
    const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!guildsRes.ok) {
      console.error('[Discord] Guilds fetch failed:', guildsRes.status);
      return res.redirect('/?guilds_error=guilds_failed');
    }

    const allGuilds = await guildsRes.json();

    // Filter: only guilds where user has ADMINISTRATOR (0x8) or MANAGE_GUILD (0x20)
    const ADMIN_FLAG = 0x8;
    const MANAGE_GUILD_FLAG = 0x20;
    const adminGuilds = allGuilds
      .filter(g => (parseInt(g.permissions) & ADMIN_FLAG) || (parseInt(g.permissions) & MANAGE_GUILD_FLAG))
      .map(g => ({ id: g.id, name: g.name, icon: g.icon }));

    // Revoke the token (we don't need it anymore)
    fetch('https://discord.com/api/oauth2/token/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        token: accessToken,
      }),
    }).catch(() => {});

    // Encode guilds as base64 and redirect
    const encoded = Buffer.from(JSON.stringify(adminGuilds)).toString('base64url');
    res.redirect('/?guilds=' + encoded);
  } catch (err) {
    console.error('[Discord] Guilds callback error:', err.message);
    res.redirect('/?guilds_error=server_error');
  }
});

// =====================================================
// STREAMER REQUEST ROUTES
// =====================================================

// POST /api/request-license - Streamer submits a license request (no guild required)
app.post('/api/request-license', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const meta = user.user_metadata || {};
    const identity = (user.identities || []).find(i => i.provider === 'discord');
    const identityData = identity?.identity_data || {};
    const discord_id = meta.provider_id || identityData.provider_id || '';
    const discord_username = meta.full_name || meta.name || identityData.full_name || '';
    const discord_avatar = meta.avatar_url || identityData.avatar_url || '';

    // Check for existing pending/payment_received request
    const { data: existing } = await supabaseAdmin
      .from('server_requests')
      .select('id, status')
      .eq('user_id', user.id)
      .in('status', ['pending', 'payment_received']);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'Une demande est deja en cours' });
    }

    const { data, error } = await supabaseAdmin
      .from('server_requests')
      .insert({
        user_id: user.id,
        discord_id,
        discord_username,
        discord_avatar,
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[Request] Submit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/my-requests - Streamer views their requests
app.get('/api/my-requests', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('server_requests')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[Request] My requests error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/my-requests/:id/twitch - Attach Twitch data to a pending request
app.put('/api/my-requests/:id/twitch', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      twitch_id, twitch_username, twitch_display_name, twitch_avatar,
      twitch_followers, twitch_broadcaster_type, twitch_avg_viewers, license_price,
    } = req.body;

    // Verify request belongs to user and is pending
    const { data: request, error: fetchErr } = await supabaseAdmin
      .from('server_requests')
      .select('id, user_id, status')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .eq('status', 'pending')
      .single();

    if (fetchErr || !request) {
      return res.status(404).json({ error: 'Demande introuvable ou statut invalide' });
    }

    const { data, error } = await supabaseAdmin
      .from('server_requests')
      .update({
        twitch_id: twitch_id || null,
        twitch_username: twitch_username || null,
        twitch_display_name: twitch_display_name || null,
        twitch_avatar: twitch_avatar || null,
        twitch_followers: twitch_followers || 0,
        twitch_broadcaster_type: twitch_broadcaster_type || null,
        twitch_avg_viewers: twitch_avg_viewers || 0,
        license_price: license_price != null ? license_price : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[Request] Attach Twitch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/requests - Admin views all requests
app.get('/api/admin/requests', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('server_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[Admin] Requests list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/requests/:id/payment - Admin marks payment received
app.post('/api/admin/requests/:id/payment', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('server_requests')
      .update({ status: 'payment_received', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Demande introuvable ou statut invalide' });

    res.json(data);
  } catch (err) {
    console.error('[Admin] Payment confirm error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/requests/:id/confirm - Admin activates the license
app.post('/api/admin/requests/:id/confirm', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch the request
    const { data: request, error: fetchErr } = await supabaseAdmin
      .from('server_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !request) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }

    if (request.status !== 'payment_received') {
      return res.status(400).json({ error: 'Le paiement doit etre confirme avant activation' });
    }

    // If no guild_id yet, just activate the request (server selection comes later)
    if (!request.guild_id) {
      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('server_requests')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (updateErr) throw updateErr;
      return res.json(updated);
    }

    // Guild exists: upsert server + auto-join + set server_id (existing flow)
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + (request.license_months || 1));

    const { data: server, error: serverErr } = await supabaseAdmin
      .from('servers')
      .upsert({
        guild_id: request.guild_id,
        guild_name: request.guild_name,
        guild_icon: request.guild_icon || null,
        licensed: true,
        license_label: request.license_label || 'Standard',
        license_price: request.license_price || 29.99,
        license_started_at: now.toISOString(),
        license_expires_at: expiresAt.toISOString(),
      }, { onConflict: 'guild_id' })
      .select()
      .single();

    if (serverErr) throw serverErr;

    // Auto-join the streamer in server_members
    if (request.user_id) {
      await supabaseAdmin
        .from('server_members')
        .upsert(
          { server_id: server.id, user_id: request.user_id },
          { onConflict: 'server_id,user_id' }
        );
    }

    // Update request status
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('server_requests')
      .update({
        status: 'active',
        server_id: server.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    res.json(updated);
  } catch (err) {
    console.error('[Admin] Activate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/requests/:id/reject - Admin rejects a request
app.post('/api/admin/requests/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { admin_note } = req.body || {};

    const { data, error } = await supabaseAdmin
      .from('server_requests')
      .update({
        status: 'rejected',
        admin_note: admin_note || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('status', ['pending', 'payment_received'])
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Demande introuvable ou déjà traitée' });

    res.json(data);
  } catch (err) {
    console.error('[Admin] Reject error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ACCOUNT DELETION
// =====================================================

// DELETE /api/my-account - Delete account and all associated data
app.delete('/api/my-account', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`[Account] Deleting account for user ${userId}`);

    // 1. Find active server requests (streamer subscriptions)
    const { data: activeRequests } = await supabaseAdmin
      .from('server_requests')
      .select('id, server_id, status')
      .eq('user_id', userId)
      .eq('status', 'active');

    // 2. If streamer: deactivate their licensed servers → cuts community access
    if (activeRequests && activeRequests.length > 0) {
      for (const req of activeRequests) {
        if (req.server_id) {
          await supabaseAdmin
            .from('servers')
            .update({ licensed: false })
            .eq('id', req.server_id);
          console.log(`[Account] Deactivated server ${req.server_id}`);
        }
      }
    }

    // 3. Delete all server_requests for this user
    await supabaseAdmin
      .from('server_requests')
      .delete()
      .eq('user_id', userId);

    // 4. Delete server_members entries (leaves all servers)
    await supabaseAdmin
      .from('server_members')
      .delete()
      .eq('user_id', userId);

    // 5. Delete profile
    await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', userId);

    // 6. Delete the auth user
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authError) {
      console.error(`[Account] Auth delete error: ${authError.message}`);
      throw authError;
    }

    console.log(`[Account] User ${userId} fully deleted`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Account] Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// SUBSCRIPTION MANAGEMENT
// =====================================================

// GET /api/my-subscription - Full subscription data (request + server license info)
app.get('/api/my-subscription', requireAuth, async (req, res) => {
  try {
    const { data: requests, error } = await supabaseAdmin
      .from('server_requests')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const active = (requests || []).find(r => r.status === 'active');
    if (!active) {
      return res.json({ subscription: null, history: requests || [] });
    }

    // Fetch server license dates
    let server = null;
    if (active.server_id) {
      const { data: srv } = await supabaseAdmin
        .from('servers')
        .select('id, guild_id, guild_name, guild_icon, licensed, license_label, license_price, license_started_at, license_expires_at')
        .eq('id', active.server_id)
        .single();
      server = srv;
    }

    res.json({
      subscription: { ...active, server },
      history: requests || [],
    });
  } catch (err) {
    console.error('[Subscription] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/my-subscription/server - Streamer updates their server info
app.put('/api/my-subscription/server', requireAuth, async (req, res) => {
  try {
    const { guild_id, guild_name, guild_icon } = req.body;
    if (!guild_id || !guild_name) {
      return res.status(400).json({ error: 'guild_id et guild_name requis' });
    }

    // Find active request
    const { data: requests } = await supabaseAdmin
      .from('server_requests')
      .select('id, server_id')
      .eq('user_id', req.user.id)
      .eq('status', 'active');

    const active = (requests || [])[0];
    if (!active) {
      return res.status(404).json({ error: 'Aucun abonnement actif' });
    }

    // Update request
    await supabaseAdmin
      .from('server_requests')
      .update({ guild_id, guild_name, guild_icon: guild_icon || null, updated_at: new Date().toISOString() })
      .eq('id', active.id);

    // Update server if exists
    if (active.server_id) {
      await supabaseAdmin
        .from('servers')
        .update({ guild_id, guild_name, guild_icon: guild_icon || null })
        .eq('id', active.server_id);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Subscription] Update server error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/my-subscription/select-server - Streamer selects guild after activation
app.post('/api/my-subscription/select-server', requireAuth, async (req, res) => {
  try {
    const { guild_id, guild_name, guild_icon } = req.body;
    if (!guild_id || !guild_name) {
      return res.status(400).json({ error: 'guild_id et guild_name requis' });
    }

    // Find active request for this user
    const { data: requests } = await supabaseAdmin
      .from('server_requests')
      .select('id, server_id, license_price, license_label')
      .eq('user_id', req.user.id)
      .eq('status', 'active');

    const active = (requests || [])[0];
    if (!active) return res.status(404).json({ error: 'Aucune licence active' });
    if (active.server_id) return res.status(409).json({ error: 'Un serveur est deja lie. Utilise "Modifier le serveur".' });

    // Create/upsert the server
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + 1);

    const { data: server, error: serverErr } = await supabaseAdmin
      .from('servers')
      .upsert({
        guild_id,
        guild_name,
        guild_icon: guild_icon || null,
        licensed: true,
        license_label: active.license_label || 'Standard',
        license_price: active.license_price || 29.99,
        license_started_at: now.toISOString(),
        license_expires_at: expiresAt.toISOString(),
      }, { onConflict: 'guild_id' })
      .select()
      .single();

    if (serverErr) throw serverErr;

    // Link server to the request
    await supabaseAdmin
      .from('server_requests')
      .update({
        guild_id,
        guild_name,
        guild_icon: guild_icon || null,
        server_id: server.id,
        updated_at: now.toISOString(),
      })
      .eq('id', active.id);

    // Auto-join the streamer
    await supabaseAdmin
      .from('server_members')
      .upsert(
        { server_id: server.id, user_id: req.user.id },
        { onConflict: 'server_id,user_id' }
      );

    res.json(server);
  } catch (err) {
    console.error('[Subscription] Select server error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/my-subscription/visibility - Toggle server public/private
app.put('/api/my-subscription/visibility', requireAuth, async (req, res) => {
  try {
    const { public: isPublic } = req.body;
    if (typeof isPublic !== 'boolean') {
      return res.status(400).json({ error: 'public (boolean) requis' });
    }

    // Find active request with server_id
    const { data: requests } = await supabaseAdmin
      .from('server_requests')
      .select('id, server_id')
      .eq('user_id', req.user.id)
      .eq('status', 'active');

    const active = (requests || [])[0];
    if (!active || !active.server_id) {
      return res.status(404).json({ error: 'Aucun abonnement actif avec serveur' });
    }

    const { data, error } = await supabaseAdmin
      .from('servers')
      .update({ public: isPublic })
      .eq('id', active.server_id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[Subscription] Visibility toggle error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// TWITCH OAUTH + DYNAMIC PRICING
// =====================================================

function calculatePrice(followers, avgViewers, broadcasterType) {
  let base;
  if (followers < 1000)        base = 299;
  else if (followers < 5000)   base = 499;
  else if (followers < 15000)  base = 799;
  else if (followers < 50000)  base = 1299;
  else if (followers < 150000) base = 2499;
  else if (followers < 500000) base = 3999;
  else return null; // "Sur devis" for 500K+

  let viewerMult = 1.0;
  if (avgViewers >= 100 && avgViewers < 500)       viewerMult = 1.15;
  else if (avgViewers >= 500 && avgViewers < 2000)  viewerMult = 1.3;
  else if (avgViewers >= 2000 && avgViewers < 5000) viewerMult = 1.6;
  else if (avgViewers >= 5000)                      viewerMult = 2.0;

  const partnerMult = broadcasterType === 'partner' ? 1.2 : 1.0;

  const raw = base * viewerMult * partnerMult;
  const rounded = Math.ceil(raw / 50) * 50 - 1;
  return Math.max(299, rounded);
}

// POST /api/twitch/auth-guest - Get Twitch OAuth URL (no auth required, for streamer onboarding)
app.post('/api/twitch/auth-guest', async (req, res) => {
  try {
    if (!TWITCH_CLIENT_ID || !TWITCH_REDIRECT_URI) {
      return res.status(503).json({ error: 'Twitch OAuth not configured' });
    }

    const state = 'guest';
    const params = new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      redirect_uri: TWITCH_REDIRECT_URI,
      response_type: 'code',
      scope: 'user:read:email moderator:read:followers',
      state,
    });

    res.json({ url: `https://id.twitch.tv/oauth2/authorize?${params.toString()}` });
  } catch (err) {
    console.error('[Twitch] Guest auth error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/twitch/auth - Get Twitch OAuth URL (authenticated)
app.post('/api/twitch/auth', requireAuth, async (req, res) => {
  try {
    if (!TWITCH_CLIENT_ID || !TWITCH_REDIRECT_URI) {
      return res.status(503).json({ error: 'Twitch OAuth not configured' });
    }

    const { request_id } = req.body;
    if (!request_id) {
      return res.status(400).json({ error: 'request_id requis' });
    }

    // Verify the request belongs to the user
    const { data: request, error } = await supabaseAdmin
      .from('server_requests')
      .select('id, user_id, status')
      .eq('id', request_id)
      .single();

    if (error || !request) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }
    if (request.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Cette demande ne peut plus être modifiée' });
    }

    // Build Twitch OAuth URL with state = request_id:user_id
    const state = `${request_id}:${req.user.id}`;
    const params = new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      redirect_uri: TWITCH_REDIRECT_URI,
      response_type: 'code',
      scope: 'user:read:email moderator:read:followers',
      state,
    });

    res.json({ url: `https://id.twitch.tv/oauth2/authorize?${params.toString()}` });
  } catch (err) {
    console.error('[Twitch] Auth init error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/twitch/callback?code=X&state=Y - Twitch OAuth callback
app.get('/api/twitch/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.redirect('/?twitch_error=missing_params');
    }

    const isGuest = state === 'guest';

    // For authenticated flow: parse state and verify request
    let requestId, userId;
    if (!isGuest) {
      [requestId, userId] = state.split(':');
      if (!requestId || !userId) {
        return res.redirect('/?twitch_error=invalid_state');
      }

      const { data: request, error: reqErr } = await supabaseAdmin
        .from('server_requests')
        .select('id, user_id, status')
        .eq('id', requestId)
        .single();

      if (reqErr || !request || request.user_id !== userId) {
        return res.redirect('/?twitch_error=invalid_request');
      }
    }

    // Exchange code for access token
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TWITCH_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      console.error('[Twitch] Token exchange failed:', await tokenRes.text());
      return res.redirect('/?twitch_error=token_failed');
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const twitchHeaders = {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id': TWITCH_CLIENT_ID,
    };

    // Fetch Twitch user data
    const userRes = await fetch('https://api.twitch.tv/helix/users', { headers: twitchHeaders });
    if (!userRes.ok) {
      return res.redirect('/?twitch_error=user_fetch_failed');
    }
    const userData = await userRes.json();
    const twitchUser = userData.data?.[0];
    if (!twitchUser) {
      return res.redirect('/?twitch_error=no_user_data');
    }

    const twitchId = twitchUser.id;
    const twitchUsername = twitchUser.login;
    const twitchDisplayName = twitchUser.display_name;
    const twitchAvatar = twitchUser.profile_image_url;
    const broadcasterType = twitchUser.broadcaster_type || '';

    // Fetch follower count
    let followers = 0;
    try {
      const followRes = await fetch(
        `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${twitchId}&first=1`,
        { headers: twitchHeaders }
      );
      if (followRes.ok) {
        const followData = await followRes.json();
        followers = followData.total || 0;
      }
    } catch (e) {
      console.error('[Twitch] Followers fetch error:', e.message);
    }

    // Estimate average viewers from recent VODs
    let avgViewers = 0;
    try {
      // Check if currently live
      const streamRes = await fetch(
        `https://api.twitch.tv/helix/streams?user_id=${twitchId}`,
        { headers: twitchHeaders }
      );
      let liveViewers = 0;
      if (streamRes.ok) {
        const streamData = await streamRes.json();
        if (streamData.data?.length > 0) {
          liveViewers = streamData.data[0].viewer_count || 0;
        }
      }

      // Fetch recent VODs for average estimate
      const videoRes = await fetch(
        `https://api.twitch.tv/helix/videos?user_id=${twitchId}&type=archive&first=10`,
        { headers: twitchHeaders }
      );
      if (videoRes.ok) {
        const videoData = await videoRes.json();
        const videos = videoData.data || [];
        if (videos.length > 0) {
          const totalViews = videos.reduce((sum, v) => sum + (v.view_count || 0), 0);
          avgViewers = Math.round(totalViews / videos.length);
        }
      }

      // Use live viewers if higher than VOD estimate
      if (liveViewers > avgViewers) {
        avgViewers = liveViewers;
      }
    } catch (e) {
      console.error('[Twitch] Viewers estimate error:', e.message);
    }

    // Calculate price
    const price = calculatePrice(followers, avgViewers, broadcasterType);

    console.log(`[Twitch] ${twitchDisplayName} connected: ${followers} followers, ~${avgViewers} avg viewers, price=${price}`);

    // Guest flow: redirect with Twitch data encoded in URL (no DB update)
    if (isGuest) {
      const twitchData = Buffer.from(JSON.stringify({
        twitch_id: twitchId,
        twitch_username: twitchUsername,
        twitch_display_name: twitchDisplayName,
        twitch_avatar: twitchAvatar,
        twitch_followers: followers,
        twitch_broadcaster_type: broadcasterType,
        twitch_avg_viewers: avgViewers,
        license_price: price,
      })).toString('base64url');
      return res.redirect('/?twitch_guest=' + twitchData);
    }

    // Authenticated flow: update the request in DB
    const { error: updateErr } = await supabaseAdmin
      .from('server_requests')
      .update({
        twitch_id: twitchId,
        twitch_username: twitchUsername,
        twitch_display_name: twitchDisplayName,
        twitch_avatar: twitchAvatar,
        twitch_followers: followers,
        twitch_broadcaster_type: broadcasterType,
        twitch_avg_viewers: avgViewers,
        license_price: price,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId);

    if (updateErr) {
      console.error('[Twitch] Update request error:', updateErr.message);
      return res.redirect('/?twitch_error=update_failed');
    }

    res.redirect('/?twitch_done=1');
  } catch (err) {
    console.error('[Twitch] Callback error:', err.message);
    res.redirect('/?twitch_error=server_error');
  }
});

// =====================================================
// SERVER OWNER MIDDLEWARE
// =====================================================
async function requireServerOwner(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Service not configured' });
  }

  const serverId = req.body?.server_id || req.query?.server_id || req.params?.server_id;
  if (!serverId) {
    return res.status(400).json({ error: 'server_id requis' });
  }

  try {
    // Check if user has an active server_request for this server
    const { data: activeReq } = await supabaseAdmin
      .from('server_requests')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('server_id', serverId)
      .eq('status', 'active')
      .maybeSingle();

    if (activeReq) {
      req.ownedServerId = serverId;
      return next();
    }

    // Or check if user's discord_id matches server's owner_discord_id
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('discord_id')
      .eq('id', req.user.id)
      .single();

    if (profile?.discord_id) {
      const { data: server } = await supabaseAdmin
        .from('servers')
        .select('id, owner_discord_id')
        .eq('id', serverId)
        .single();

      if (server && server.owner_discord_id === profile.discord_id) {
        req.ownedServerId = serverId;
        return next();
      }
    }

    return res.status(403).json({ error: 'Tu n\'es pas owner de ce serveur' });
  } catch (err) {
    console.error('[Owner] Check error:', err.message);
    return res.status(500).json({ error: 'Erreur verification owner' });
  }
}

// =====================================================
// TOURNAMENT ROUTES
// =====================================================

// GET /api/tournaments - List open/in_progress tournaments
app.get('/api/tournaments', async (req, res) => {
  try {
    const { server_id } = req.query;
    let query = supabaseAdmin
      .from('tournaments')
      .select('*, servers!tournaments_server_id_fkey(guild_name, guild_icon, guild_id), partner:servers!tournaments_partner_server_id_fkey(guild_name, guild_icon, guild_id)')
      .in('status', ['open', 'in_progress', 'pending_partner'])
      .order('starts_at', { ascending: true });

    if (server_id) {
      query = query.or(`server_id.eq.${server_id},partner_server_id.eq.${server_id}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[Tournaments] List error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tournaments/:id - Tournament detail with participants
app.get('/api/tournaments/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: tournament, error } = await supabaseAdmin
      .from('tournaments')
      .select('*, servers!tournaments_server_id_fkey(guild_name, guild_icon, guild_id), partner:servers!tournaments_partner_server_id_fkey(guild_name, guild_icon, guild_id)')
      .eq('id', id)
      .single();

    if (error || !tournament) {
      return res.status(404).json({ error: 'Tournoi introuvable' });
    }

    // Fetch participants with profiles
    const { data: participants } = await supabaseAdmin
      .from('tournament_participants')
      .select('*, profiles:user_id(discord_username, discord_avatar, riot_game_name, riot_tag_line, rank_tier, rank_division)')
      .eq('tournament_id', id)
      .order('registered_at', { ascending: true });

    res.json({ ...tournament, participants: participants || [] });
  } catch (err) {
    console.error('[Tournaments] Detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tournaments - Create tournament (owner only)
app.post('/api/tournaments', requireAuth, async (req, res) => {
  try {
    const { title, description, format, server_id, max_participants, rank_min, rank_max, prize, rules, starts_at, ends_at, is_cross_community, target_server_id } = req.body;

    if (!title || !server_id || !starts_at) {
      return res.status(400).json({ error: 'title, server_id et starts_at requis' });
    }

    // Verify ownership
    const { data: activeReq } = await supabaseAdmin
      .from('server_requests')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('server_id', server_id)
      .eq('status', 'active')
      .maybeSingle();

    let isOwner = !!activeReq;
    if (!isOwner) {
      const { data: profile } = await supabaseAdmin.from('profiles').select('discord_id').eq('id', req.user.id).single();
      if (profile?.discord_id) {
        const { data: server } = await supabaseAdmin.from('servers').select('owner_discord_id').eq('id', server_id).single();
        isOwner = server?.owner_discord_id === profile.discord_id;
      }
    }
    if (!isOwner) return res.status(403).json({ error: 'Non autorise' });

    const tournamentData = {
      title: title.slice(0, 100),
      description: description || '',
      format: format || '5v5',
      server_id,
      created_by: req.user.id,
      max_participants: max_participants || 32,
      rank_min: rank_min || null,
      rank_max: rank_max || null,
      prize: prize || null,
      rules: rules || '',
      starts_at,
      ends_at: ends_at || null,
      is_cross_community: !!is_cross_community,
      status: (is_cross_community && target_server_id) ? 'pending_partner' : 'open',
    };

    const { data: tournament, error } = await supabaseAdmin
      .from('tournaments')
      .insert(tournamentData)
      .select()
      .single();

    if (error) throw error;

    // If cross-community, create request
    if (is_cross_community && target_server_id) {
      await supabaseAdmin.from('tournament_requests').insert({
        tournament_id: tournament.id,
        from_server_id: server_id,
        to_server_id: target_server_id,
        requested_by: req.user.id,
        status: 'pending',
        message: `Invitation pour un tournoi cross-communaute: ${title}`,
      });
    }

    res.json(tournament);
  } catch (err) {
    console.error('[Tournaments] Create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tournaments/:id - Update tournament (owner only)
app.put('/api/tournaments/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch tournament to verify ownership
    const { data: tournament } = await supabaseAdmin
      .from('tournaments')
      .select('server_id, created_by')
      .eq('id', id)
      .single();

    if (!tournament) return res.status(404).json({ error: 'Tournoi introuvable' });
    if (tournament.created_by !== req.user.id) return res.status(403).json({ error: 'Non autorise' });

    const allowed = ['title', 'description', 'format', 'max_participants', 'rank_min', 'rank_max', 'prize', 'rules', 'starts_at', 'ends_at'];
    const updates = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const { data, error } = await supabaseAdmin
      .from('tournaments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[Tournaments] Update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tournaments/:id/cancel - Cancel tournament
app.post('/api/tournaments/:id/cancel', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: tournament } = await supabaseAdmin.from('tournaments').select('created_by').eq('id', id).single();
    if (!tournament) return res.status(404).json({ error: 'Tournoi introuvable' });
    if (tournament.created_by !== req.user.id) return res.status(403).json({ error: 'Non autorise' });

    const { data, error } = await supabaseAdmin
      .from('tournaments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .in('status', ['open', 'pending_partner'])
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[Tournaments] Cancel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tournaments/:id/start - Start tournament
app.post('/api/tournaments/:id/start', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: tournament } = await supabaseAdmin.from('tournaments').select('created_by').eq('id', id).single();
    if (!tournament) return res.status(404).json({ error: 'Tournoi introuvable' });
    if (tournament.created_by !== req.user.id) return res.status(403).json({ error: 'Non autorise' });

    const { data, error } = await supabaseAdmin
      .from('tournaments')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'open')
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[Tournaments] Start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tournaments/:id/complete - Complete tournament
app.post('/api/tournaments/:id/complete', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: tournament } = await supabaseAdmin.from('tournaments').select('created_by').eq('id', id).single();
    if (!tournament) return res.status(404).json({ error: 'Tournoi introuvable' });
    if (tournament.created_by !== req.user.id) return res.status(403).json({ error: 'Non autorise' });

    const { data, error } = await supabaseAdmin
      .from('tournaments')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'in_progress')
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[Tournaments] Complete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Tournament Request Routes ---

// GET /api/tournament-requests?server_id=X - Incoming requests for a server
app.get('/api/tournament-requests', requireAuth, async (req, res) => {
  try {
    const { server_id } = req.query;
    if (!server_id) return res.status(400).json({ error: 'server_id requis' });

    const { data, error } = await supabaseAdmin
      .from('tournament_requests')
      .select('*, tournaments(title, format, starts_at, status, server_id, servers!tournaments_server_id_fkey(guild_name))')
      .eq('to_server_id', server_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[TRequests] List error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tournament-requests/:id/accept - Accept a cross-community request
app.post('/api/tournament-requests/:id/accept', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: request, error: fetchErr } = await supabaseAdmin
      .from('tournament_requests')
      .select('*, tournaments(id, server_id, status)')
      .eq('id', id)
      .eq('status', 'pending')
      .single();

    if (fetchErr || !request) return res.status(404).json({ error: 'Demande introuvable' });

    // Verify requester is owner of the target server
    // (simplified: just check auth)

    // Update request
    await supabaseAdmin
      .from('tournament_requests')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', id);

    // Update tournament: set partner_server_id and status to open
    await supabaseAdmin
      .from('tournaments')
      .update({
        partner_server_id: request.to_server_id,
        status: 'open',
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.tournament_id);

    res.json({ ok: true });
  } catch (err) {
    console.error('[TRequests] Accept error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tournament-requests/:id/decline - Decline a cross-community request
app.post('/api/tournament-requests/:id/decline', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: request, error: fetchErr } = await supabaseAdmin
      .from('tournament_requests')
      .select('tournament_id')
      .eq('id', id)
      .eq('status', 'pending')
      .single();

    if (fetchErr || !request) return res.status(404).json({ error: 'Demande introuvable' });

    // Update request
    await supabaseAdmin
      .from('tournament_requests')
      .update({ status: 'declined', responded_at: new Date().toISOString() })
      .eq('id', id);

    // Tournament reverts to open without partner
    await supabaseAdmin
      .from('tournaments')
      .update({
        status: 'open',
        partner_server_id: null,
        is_cross_community: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.tournament_id)
      .eq('status', 'pending_partner');

    res.json({ ok: true });
  } catch (err) {
    console.error('[TRequests] Decline error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Tournament Participant Routes ---

// POST /api/tournaments/:id/register - Register for a tournament
app.post('/api/tournaments/:id/register', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch tournament
    const { data: tournament, error: tErr } = await supabaseAdmin
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .single();

    if (tErr || !tournament) return res.status(404).json({ error: 'Tournoi introuvable' });
    if (tournament.status !== 'open') return res.status(400).json({ error: 'Les inscriptions ne sont pas ouvertes' });
    if (tournament.participant_count >= tournament.max_participants) return res.status(400).json({ error: 'Tournoi complet' });

    // Check membership
    const serverIds = [tournament.server_id, tournament.partner_server_id].filter(Boolean);
    const { data: membership } = await supabaseAdmin
      .from('server_members')
      .select('server_id')
      .eq('user_id', req.user.id)
      .in('server_id', serverIds)
      .limit(1)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Tu dois etre membre de la communaute pour t\'inscrire' });

    // Check rank bounds
    if (tournament.rank_min || tournament.rank_max) {
      const { data: profile } = await supabaseAdmin.from('profiles').select('rank_tier').eq('id', req.user.id).single();
      if (profile?.rank_tier && profile.rank_tier !== 'UNRANKED') {
        const rankOrder = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
        const idx = rankOrder.indexOf(profile.rank_tier);
        if (tournament.rank_min && idx < rankOrder.indexOf(tournament.rank_min)) {
          return res.status(400).json({ error: `Rang minimum requis: ${tournament.rank_min}` });
        }
        if (tournament.rank_max && idx > rankOrder.indexOf(tournament.rank_max)) {
          return res.status(400).json({ error: `Rang maximum: ${tournament.rank_max}` });
        }
      }
    }

    const { data, error } = await supabaseAdmin
      .from('tournament_participants')
      .insert({
        tournament_id: id,
        user_id: req.user.id,
        server_id: membership.server_id,
      })
      .select()
      .single();

    if (error) {
      if (error.message.includes('duplicate') || error.code === '23505') {
        return res.status(409).json({ error: 'Tu es deja inscrit' });
      }
      throw error;
    }

    res.json(data);
  } catch (err) {
    console.error('[Tournaments] Register error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tournaments/:id/register - Unregister from a tournament
app.delete('/api/tournaments/:id/register', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('tournament_participants')
      .delete()
      .eq('tournament_id', id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[Tournaments] Unregister error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// RIOT API ROUTES
// =====================================================

// --- POST /api/verify-riot ---
app.post('/api/verify-riot', async (req, res) => {
  try {
    const { gameName, tagLine } = req.body;
    console.log(`[Riot API] Verification de ${gameName}#${tagLine}`);

    if (!gameName || !tagLine) {
      return res.status(400).json({ error: 'gameName et tagLine requis' });
    }

    // Step 1: Get PUUID
    const accountUrl = `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const accountRes = await riotFetch(accountUrl);

    if (!accountRes.ok) {
      if (accountRes.status === 404) {
        return res.status(404).json({ error: `Joueur "${gameName}#${tagLine}" introuvable` });
      }
      if (accountRes.status === 403 || accountRes.status === 401) {
        return res.status(403).json({ error: 'Clé API Riot expirée ou invalide' });
      }
      return res.status(500).json({ error: `Riot API erreur: ${accountRes.status}` });
    }

    const account = await accountRes.json();
    const puuid = account.puuid;

    if (!puuid) {
      return res.status(500).json({ error: 'PUUID non retourne par Riot' });
    }

    // Step 2: Get ranked data by PUUID
    const rankedUrl = `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`;
    const rankedRes = await riotFetch(rankedUrl);

    if (!rankedRes.ok) {
      // Fallback: legacy summoner approach
      const result = await tryLegacyApproach(puuid);
      return res.json(result);
    }

    const rankedEntries = await rankedRes.json();
    const soloQueue = rankedEntries.find(e => e.queueType === 'RANKED_SOLO_5x5');

    res.json({
      puuid,
      rank: soloQueue ? soloQueue.tier : 'UNRANKED',
      division: soloQueue ? soloQueue.rank : null,
      wins: soloQueue ? soloQueue.wins : 0,
      losses: soloQueue ? soloQueue.losses : 0,
      lp: soloQueue ? soloQueue.leaguePoints : 0,
      verified: true,
    });
  } catch (err) {
    console.error(`[Riot API] CRASH: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// --- GET /api/riot/summoner?puuid=X ---
app.get('/api/riot/summoner', async (req, res) => {
  try {
    const { puuid } = req.query;
    if (!puuid) return res.status(400).json({ error: 'puuid requis' });

    const apiUrl = `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`;
    const apiRes = await riotFetch(apiUrl);
    const data = await apiRes.json();
    res.status(apiRes.status).json(data);
  } catch (err) {
    console.error('[Riot API] summoner error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- GET /api/riot/rank?puuid=X ---
app.get('/api/riot/rank', async (req, res) => {
  try {
    const { puuid } = req.query;
    if (!puuid) return res.status(400).json({ error: 'puuid requis' });

    const apiUrl = `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`;
    const apiRes = await riotFetch(apiUrl);
    const data = await apiRes.json();
    res.status(apiRes.status).json(data);
  } catch (err) {
    console.error('[Riot API] rank error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- GET /api/riot/mastery?puuid=X&count=10 ---
app.get('/api/riot/mastery', async (req, res) => {
  try {
    const { puuid, count = '10' } = req.query;
    if (!puuid) return res.status(400).json({ error: 'puuid requis' });

    const apiUrl = `https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}/top?count=${encodeURIComponent(count)}`;
    const apiRes = await riotFetch(apiUrl);
    const data = await apiRes.json();
    res.status(apiRes.status).json(data);
  } catch (err) {
    console.error('[Riot API] mastery error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- GET /api/riot/matches?puuid=X&count=10&type=ranked&start=0 ---
app.get('/api/riot/matches', async (req, res) => {
  try {
    const { puuid, count = '10', type = '', start = '0' } = req.query;
    if (!puuid) return res.status(400).json({ error: 'puuid requis' });

    let apiUrl = `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?count=${encodeURIComponent(count)}&start=${encodeURIComponent(start)}`;
    if (type) apiUrl += `&type=${encodeURIComponent(type)}`;

    const apiRes = await riotFetch(apiUrl);
    const data = await apiRes.json();
    res.status(apiRes.status).json(data);
  } catch (err) {
    console.error('[Riot API] matches error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- GET /api/riot/match/:matchId ---
app.get('/api/riot/match/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    if (!matchId) return res.status(400).json({ error: 'matchId requis' });

    const apiUrl = `https://europe.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
    const apiRes = await riotFetch(apiUrl);
    const data = await apiRes.json();
    res.status(apiRes.status).json(data);
  } catch (err) {
    console.error('[Riot API] match detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Legacy fallback ---
async function tryLegacyApproach(puuid) {
  try {
    const summonerUrl = `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
    const summonerRes = await riotFetch(summonerUrl);

    if (!summonerRes.ok) {
      return { puuid, rank: 'UNRANKED', division: null, verified: true };
    }

    const summoner = await summonerRes.json();
    if (!summoner.id) {
      return { puuid, rank: 'UNRANKED', division: null, verified: true };
    }

    const rankedUrl = `https://euw1.api.riotgames.com/lol/league/v4/entries/by-summoner/${summoner.id}`;
    const rankedRes = await riotFetch(rankedUrl);

    if (!rankedRes.ok) {
      return { puuid, rank: 'UNRANKED', division: null, verified: true };
    }

    const rankedEntries = await rankedRes.json();
    const soloQueue = rankedEntries.find(e => e.queueType === 'RANKED_SOLO_5x5');

    return {
      puuid,
      rank: soloQueue ? soloQueue.tier : 'UNRANKED',
      division: soloQueue ? soloQueue.rank : null,
      wins: soloQueue ? soloQueue.wins : 0,
      losses: soloQueue ? soloQueue.losses : 0,
      lp: soloQueue ? soloQueue.leaguePoints : 0,
      verified: true,
    };
  } catch (err) {
    console.log(`[Riot API] Legacy approach failed: ${err.message}`);
    return { puuid, rank: 'UNRANKED', division: null, verified: true };
  }
}

app.listen(PORT, () => {
  console.log(`[Lezgo API] Running on port ${PORT}`);
});
