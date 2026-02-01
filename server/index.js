import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.RIOT_API_KEY;

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
        return res.status(403).json({ error: 'Acces refuse' });
      }
    } else if (profile.discord_id !== ADMIN_DISCORD_ID) {
      return res.status(403).json({ error: 'Acces refuse' });
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
    if (!guild_id || !guild_name) {
      return res.status(400).json({ error: 'guild_id et guild_name requis' });
    }

    const { data, error } = await supabaseAdmin
      .from('servers')
      .upsert({
        guild_id,
        guild_name,
        guild_icon: guild_icon || null,
      }, { onConflict: 'guild_id' })
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
        return res.status(403).json({ error: 'Cle API Riot expiree ou invalide' });
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
