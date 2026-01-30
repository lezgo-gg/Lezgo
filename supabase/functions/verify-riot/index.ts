// Supabase Edge Function - Verify Riot ID and pull rank
// Deploy with: supabase functions deploy verify-riot
// Set secret: supabase secrets set RIOT_API_KEY=your-key

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RIOT_API_KEY = Deno.env.get('RIOT_API_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { gameName, tagLine } = await req.json();

    if (!gameName || !tagLine) {
      return new Response(
        JSON.stringify({ error: 'gameName et tagLine requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!RIOT_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'RIOT_API_KEY non configuree. Voir README.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 1: Get PUUID from Riot Account API
    const accountUrl = `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const accountRes = await fetch(accountUrl, {
      headers: { 'X-Riot-Token': RIOT_API_KEY },
    });

    if (!accountRes.ok) {
      if (accountRes.status === 404) {
        return new Response(
          JSON.stringify({ error: `Joueur "${gameName}#${tagLine}" introuvable` }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Riot Account API error: ${accountRes.status}`);
    }

    const account = await accountRes.json();
    const puuid = account.puuid;

    // Step 2: Get Summoner ID from PUUID (needed for ranked data)
    const summonerUrl = `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
    const summonerRes = await fetch(summonerUrl, {
      headers: { 'X-Riot-Token': RIOT_API_KEY },
    });

    if (!summonerRes.ok) {
      // Player might not have played on EUW, return unranked
      return new Response(
        JSON.stringify({ puuid, rank: 'UNRANKED', division: null, verified: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const summoner = await summonerRes.json();

    // Step 3: Get ranked data
    const rankedUrl = `https://euw1.api.riotgames.com/lol/league/v4/entries/by-summoner/${summoner.id}`;
    const rankedRes = await fetch(rankedUrl, {
      headers: { 'X-Riot-Token': RIOT_API_KEY },
    });

    if (!rankedRes.ok) {
      return new Response(
        JSON.stringify({ puuid, rank: 'UNRANKED', division: null, verified: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rankedEntries = await rankedRes.json();

    // Find Solo/Duo queue entry
    const soloQueue = rankedEntries.find(
      (entry: { queueType: string }) => entry.queueType === 'RANKED_SOLO_5x5'
    );

    const rank = soloQueue ? soloQueue.tier : 'UNRANKED';
    const division = soloQueue ? soloQueue.rank : null;

    return new Response(
      JSON.stringify({ puuid, rank, division, verified: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
