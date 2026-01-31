import 'dotenv/config';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.RIOT_API_KEY;

if (!API_KEY) {
  console.error('[API] RIOT_API_KEY manquant dans .env');
  process.exit(1);
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
