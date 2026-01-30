import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      riotApiProxy(env.VITE_RIOT_API_KEY),
    ],
  };
});

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

async function riotFetch(url, apiKey) {
  await rateLimiter.wait();
  return fetch(url, { headers: { 'X-Riot-Token': apiKey } });
}

function riotApiProxy(apiKey) {
  return {
    name: 'riot-api-proxy',
    configureServer(server) {

      // --- Existing: POST /api/verify-riot ---
      server.middlewares.use('/api/verify-riot', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' });
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const { gameName, tagLine } = JSON.parse(body);
            console.log(`[Riot API] Verification de ${gameName}#${tagLine}`);

            if (!gameName || !tagLine) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'gameName et tagLine requis' }));
              return;
            }

            if (!apiKey) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'VITE_RIOT_API_KEY non configuree dans .env' }));
              return;
            }

            // Step 1: Get PUUID from Riot Account API
            console.log('[Riot API] Step 1: Account lookup...');
            const accountUrl = `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
            const accountRes = await riotFetch(accountUrl, apiKey);

            console.log(`[Riot API] Step 1 status: ${accountRes.status}`);

            if (!accountRes.ok) {
              const errorBody = await accountRes.text();
              console.log(`[Riot API] Step 1 error: ${errorBody}`);
              if (accountRes.status === 404) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Joueur "${gameName}#${tagLine}" introuvable` }));
                return;
              }
              if (accountRes.status === 403 || accountRes.status === 401) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Cle API Riot expiree ou invalide. Regenere-la sur developer.riotgames.com' }));
                return;
              }
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Riot API erreur: ${accountRes.status}` }));
              return;
            }

            const account = await accountRes.json();
            const puuid = account.puuid;
            console.log(`[Riot API] Step 1 OK - PUUID obtenu, gameName: ${account.gameName}#${account.tagLine}`);

            if (!puuid) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'PUUID non retourne par Riot' }));
              return;
            }

            // Step 2: Get ranked data directly by PUUID (new Riot API)
            console.log('[Riot API] Step 2: Ranked lookup by PUUID...');
            const rankedUrl = `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`;
            const rankedRes = await riotFetch(rankedUrl, apiKey);

            console.log(`[Riot API] Step 2 status: ${rankedRes.status}`);

            if (!rankedRes.ok) {
              const errorBody = await rankedRes.text();
              console.log(`[Riot API] Step 2 error: ${errorBody}`);

              // Fallback: try legacy summoner ID approach
              console.log('[Riot API] Fallback: trying summoner lookup...');
              const result = await tryLegacyApproach(puuid, apiKey);
              console.log(`[Riot API] Resultat final: ${JSON.stringify(result)}`);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
              return;
            }

            const rankedEntries = await rankedRes.json();
            console.log(`[Riot API] Step 2 OK - ${rankedEntries.length} queue(s):`);
            rankedEntries.forEach(e => {
              console.log(`  - ${e.queueType}: ${e.tier} ${e.rank} (${e.wins}W/${e.losses}L)`);
            });

            const soloQueue = rankedEntries.find(e => e.queueType === 'RANKED_SOLO_5x5');

            const result = {
              puuid,
              rank: soloQueue ? soloQueue.tier : 'UNRANKED',
              division: soloQueue ? soloQueue.rank : null,
              wins: soloQueue ? soloQueue.wins : 0,
              losses: soloQueue ? soloQueue.losses : 0,
              lp: soloQueue ? soloQueue.leaguePoints : 0,
              verified: true,
            };

            console.log(`[Riot API] Resultat final: ${JSON.stringify(result)}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));

          } catch (err) {
            console.error(`[Riot API] CRASH: ${err.message}`);
            console.error(err.stack);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // --- GET /api/riot/summoner?puuid=X ---
      server.middlewares.use('/api/riot/summoner', async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        try {
          const url = new URL(req.url, 'http://localhost');
          const puuid = url.searchParams.get('puuid');
          if (!puuid) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'puuid requis' }));
            return;
          }
          const apiUrl = `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`;
          const apiRes = await riotFetch(apiUrl, apiKey);
          const data = await apiRes.json();
          res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (err) {
          console.error('[Riot API] summoner error:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // --- GET /api/riot/rank?puuid=X ---
      server.middlewares.use('/api/riot/rank', async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        try {
          const url = new URL(req.url, 'http://localhost');
          const puuid = url.searchParams.get('puuid');
          if (!puuid) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'puuid requis' }));
            return;
          }
          const apiUrl = `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`;
          const apiRes = await riotFetch(apiUrl, apiKey);
          const data = await apiRes.json();
          res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (err) {
          console.error('[Riot API] rank error:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // --- GET /api/riot/mastery?puuid=X&count=10 ---
      server.middlewares.use('/api/riot/mastery', async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        try {
          const url = new URL(req.url, 'http://localhost');
          const puuid = url.searchParams.get('puuid');
          const count = url.searchParams.get('count') || '10';
          if (!puuid) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'puuid requis' }));
            return;
          }
          const apiUrl = `https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}/top?count=${encodeURIComponent(count)}`;
          const apiRes = await riotFetch(apiUrl, apiKey);
          const data = await apiRes.json();
          res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (err) {
          console.error('[Riot API] mastery error:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // --- GET /api/riot/matches?puuid=X&count=10 ---
      server.middlewares.use('/api/riot/matches', async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        try {
          const url = new URL(req.url, 'http://localhost');
          const puuid = url.searchParams.get('puuid');
          const count = url.searchParams.get('count') || '10';
          if (!puuid) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'puuid requis' }));
            return;
          }
          const type = url.searchParams.get('type') || '';
          const start = url.searchParams.get('start') || '0';
          let apiUrl = `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?count=${encodeURIComponent(count)}&start=${encodeURIComponent(start)}`;
          if (type) apiUrl += `&type=${encodeURIComponent(type)}`;
          const apiRes = await riotFetch(apiUrl, apiKey);
          const data = await apiRes.json();
          res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (err) {
          console.error('[Riot API] matches error:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // --- GET /api/riot/match/MATCHID ---
      server.middlewares.use('/api/riot/match/', async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        try {
          // Extract matchId from the URL path: /api/riot/match/EUW1_12345
          const matchId = decodeURIComponent(req.url.split('?')[0].replace(/^\//, ''));
          if (!matchId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'matchId requis' }));
            return;
          }
          const apiUrl = `https://europe.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
          const apiRes = await riotFetch(apiUrl, apiKey);
          const data = await apiRes.json();
          res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (err) {
          console.error('[Riot API] match detail error:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

    },
  };
}

async function tryLegacyApproach(puuid, apiKey) {
  try {
    const summonerUrl = `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
    const summonerRes = await riotFetch(summonerUrl, apiKey);

    if (!summonerRes.ok) {
      console.log(`[Riot API] Legacy summoner lookup failed: ${summonerRes.status}`);
      return { puuid, rank: 'UNRANKED', division: null, verified: true };
    }

    const summoner = await summonerRes.json();
    console.log('[Riot API] Legacy summoner response:', JSON.stringify(summoner));

    if (!summoner.id) {
      console.log('[Riot API] No summoner.id in response');
      return { puuid, rank: 'UNRANKED', division: null, verified: true };
    }

    const rankedUrl = `https://euw1.api.riotgames.com/lol/league/v4/entries/by-summoner/${summoner.id}`;
    const rankedRes = await riotFetch(rankedUrl, apiKey);

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
