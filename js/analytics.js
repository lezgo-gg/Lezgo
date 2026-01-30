// --- Data Dragon ---
let ddVersion = null;

async function getDDVersion() {
  if (ddVersion) return ddVersion;
  const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
  const versions = await res.json();
  ddVersion = versions[0];
  return ddVersion;
}

export async function getChampionIconUrl(championName) {
  const v = await getDDVersion();
  return `https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${championName}.png`;
}

export async function getProfileIconUrl(iconId) {
  const v = await getDDVersion();
  return `https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${iconId}.png`;
}

// --- Champion ID → name mapping ---
let championMap = null;

async function getChampionMap() {
  if (championMap) return championMap;
  const v = await getDDVersion();
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/champion.json`);
  const data = await res.json();
  championMap = {};
  for (const [, champ] of Object.entries(data.data)) {
    championMap[parseInt(champ.key)] = champ.id;
  }
  return championMap;
}

// --- Item icon URL ---
export async function getItemIconUrl(itemId) {
  if (!itemId || itemId === 0) return '';
  const v = await getDDVersion();
  return `https://ddragon.leagueoflegends.com/cdn/${v}/img/item/${itemId}.png`;
}

// --- Summoner spell ID → icon URL mapping ---
let spellMap = null;

async function getSummonerSpellMap() {
  if (spellMap) return spellMap;
  const v = await getDDVersion();
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/summoner.json`);
  const data = await res.json();
  spellMap = {};
  for (const [, spell] of Object.entries(data.data)) {
    spellMap[parseInt(spell.key)] = spell.id;
  }
  return spellMap;
}

export async function getSummonerSpellIconUrl(spellId) {
  if (!spellId) return '';
  const map = await getSummonerSpellMap();
  const spellName = map[spellId];
  if (!spellName) return '';
  const v = await getDDVersion();
  return `https://ddragon.leagueoflegends.com/cdn/${v}/img/spell/${spellName}.png`;
}

// --- Rune / Perk ID → icon URL ---
let runesData = null;

async function getRunesData() {
  if (runesData) return runesData;
  const v = await getDDVersion();
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/runesReforged.json`);
  runesData = await res.json();
  return runesData;
}

export async function getRuneIconUrl(perkId) {
  if (!perkId) return '';
  const data = await getRunesData();
  // Search for the perk in all trees
  for (const tree of data) {
    // Check if it's a tree ID
    if (tree.id === perkId) {
      return `https://ddragon.leagueoflegends.com/cdn/img/${tree.icon}`;
    }
    // Check individual runes in slots
    for (const slot of tree.slots) {
      for (const rune of slot.runes) {
        if (rune.id === perkId) {
          return `https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`;
        }
      }
    }
  }
  return '';
}

// --- Item details ---
let itemsFullData = null;

async function getItemsFullData() {
  if (itemsFullData) return itemsFullData;
  const v = await getDDVersion();
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/item.json`);
  const data = await res.json();
  itemsFullData = data.data;
  return itemsFullData;
}

export async function getItemDetails(itemId) {
  if (!itemId || itemId === 0) return null;
  const items = await getItemsFullData();
  const item = items[String(itemId)];
  if (!item) return null;
  return {
    name: item.name,
    description: item.description,
    plaintext: item.plaintext || '',
    gold: item.gold,
    iconUrl: await getItemIconUrl(itemId),
  };
}

// --- Summoner spell details ---
let spellsFullData = null;

async function getSpellsFullData() {
  if (spellsFullData) return spellsFullData;
  const v = await getDDVersion();
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/summoner.json`);
  const data = await res.json();
  spellsFullData = data.data;
  return spellsFullData;
}

export async function getSummonerSpellDetails(spellId) {
  if (!spellId) return null;
  const data = await getSpellsFullData();
  for (const [, spell] of Object.entries(data)) {
    if (parseInt(spell.key) === spellId) {
      return {
        name: spell.name,
        description: spell.description,
        cooldown: spell.cooldown?.[0],
        iconUrl: await getSummonerSpellIconUrl(spellId),
      };
    }
  }
  return null;
}

// --- Rune details ---
export async function getRuneDetails(perkId) {
  if (!perkId) return null;
  const data = await getRunesData();
  for (const tree of data) {
    if (tree.id === perkId) {
      return {
        name: tree.name,
        description: '',
        iconUrl: `https://ddragon.leagueoflegends.com/cdn/img/${tree.icon}`,
        isTree: true,
      };
    }
    for (const slot of tree.slots) {
      for (const rune of slot.runes) {
        if (rune.id === perkId) {
          return {
            name: rune.name,
            description: rune.shortDesc || rune.longDesc || '',
            iconUrl: `https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`,
            treeName: tree.name,
          };
        }
      }
    }
  }
  return null;
}

// --- Queue ID → Name mapping ---
const QUEUE_MAP = {
  0: 'Custom',
  400: 'Normal Draft',
  420: 'Ranked Solo',
  430: 'Normal Blind',
  440: 'Ranked Flex',
  450: 'ARAM',
  700: 'Clash',
  830: 'Co-op Intro',
  840: 'Co-op Beginner',
  850: 'Co-op Intermediate',
  900: 'ARURF',
  1020: 'One for All',
  1300: 'Nexus Blitz',
  1400: 'Ultimate Spellbook',
  1700: 'Arena',
  1900: 'Pick URF',
};

export function getQueueName(queueId) {
  return QUEUE_MAP[queueId] || 'Autre';
}

// --- Fetch match history page for display (all types, paginated) ---
export async function fetchMatchHistoryPage(puuid, start = 0, count = 10, type = '') {
  // Fetch match IDs
  let url = `/api/riot/matches?puuid=${encodeURIComponent(puuid)}&count=${count}&start=${start}`;
  if (type) url += `&type=${encodeURIComponent(type)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Matches API error: ${res.status}`);
  const matchIds = await res.json();

  if (!matchIds || matchIds.length === 0) return [];

  // Fetch each match detail
  const matches = [];
  for (const id of matchIds) {
    const matchRes = await fetch(`/api/riot/match/${encodeURIComponent(id)}`);
    if (!matchRes.ok) continue;
    const matchData = await matchRes.json();
    const entry = extractMatchHistoryEntry(matchData, puuid);
    if (entry) matches.push(entry);
  }

  return matches;
}

// --- Extract display-ready match entry from raw match data ---
function extractMatchHistoryEntry(matchData, puuid) {
  const info = matchData.info;
  const p = info.participants.find(pp => pp.puuid === puuid);
  if (!p) return null;

  const dur = info.gameDuration;
  const durMin = Math.floor(dur / 60);
  const durSec = dur % 60;
  const teamId = p.teamId;
  const teammates = info.participants.filter(pp => pp.teamId === teamId);
  const teamKills = teammates.reduce((s, pp) => s + pp.kills, 0);
  const kp = teamKills > 0 ? Math.round(((p.kills + p.assists) / teamKills) * 100) : 0;
  const csTotal = (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0);
  const csPerMin = dur > 0 ? (csTotal / (dur / 60)).toFixed(1) : '0';
  const deaths = p.deaths || 0;
  const kdaRatio = deaths > 0 ? ((p.kills + p.assists) / deaths).toFixed(2) : 'Perfect';

  // Primary keystone & secondary tree
  let primaryRuneId = 0;
  let secondaryTreeId = 0;
  if (p.perks && p.perks.styles) {
    const primary = p.perks.styles.find(s => s.description === 'primaryStyle');
    const secondary = p.perks.styles.find(s => s.description === 'subStyle');
    if (primary && primary.selections && primary.selections.length > 0) {
      primaryRuneId = primary.selections[0].perk;
    }
    if (secondary) {
      secondaryTreeId = secondary.style;
    }
  }

  return {
    matchId: matchData.metadata.matchId,
    win: p.win,
    queueId: info.queueId,
    gameCreation: info.gameCreation,
    gameDuration: `${durMin}:${String(durSec).padStart(2, '0')}`,
    gameDurationSeconds: dur,
    championName: p.championName,
    champLevel: p.champLevel,
    summoner1Id: p.summoner1Id,
    summoner2Id: p.summoner2Id,
    primaryRuneId,
    secondaryTreeId,
    kills: p.kills,
    deaths,
    assists: p.assists,
    kdaRatio,
    csTotal,
    csPerMin,
    visionScore: p.visionScore || 0,
    killParticipation: kp,
    items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
    playerTeamId: teamId,
    participants: info.participants.map(pp => ({
      puuid: pp.puuid,
      championName: pp.championName,
      teamId: pp.teamId,
      summonerName: (pp.riotIdGameName || pp.summonerName || '').trim(),
      tagLine: (pp.riotIdTagline || '').trim(),
      kills: pp.kills,
      deaths: pp.deaths,
      assists: pp.assists,
      totalDamageDealtToChampions: pp.totalDamageDealtToChampions,
      cs: (pp.totalMinionsKilled || 0) + (pp.neutralMinionsKilled || 0),
      visionScore: pp.visionScore || 0,
      goldEarned: pp.goldEarned,
      items: [pp.item0, pp.item1, pp.item2, pp.item3, pp.item4, pp.item5, pp.item6],
      champLevel: pp.champLevel,
    })),
    teams: info.teams ? info.teams.map(t => ({
      teamId: t.teamId,
      win: t.win,
      baronKills: t.objectives?.baron?.kills || 0,
      dragonKills: t.objectives?.dragon?.kills || 0,
      towerKills: t.objectives?.tower?.kills || 0,
      riftHeraldKills: t.objectives?.riftHerald?.kills || 0,
    })) : [],
  };
}

// --- Known champion synergies (duo lane combos) ---
// Key = champion, Value = array of synergy champions with bonus context
const CHAMPION_SYNERGIES = {
  // ADC + Support combos
  Jinx: ['Lulu', 'Thresh', 'Nami', 'Nautilus', 'Janna'],
  Kaisa: ['Nautilus', 'Thresh', 'Alistar', 'Leona', 'Braum'],
  Ezreal: ['Karma', 'Yuumi', 'Lux', 'Nami', 'Braum'],
  Jhin: ['Xerath', 'Zyra', 'Morgana', 'Thresh', 'Nami'],
  Vayne: ['Lulu', 'Nami', 'Thresh', 'Janna', 'Soraka'],
  MissFortune: ['Leona', 'Nautilus', 'Amumu', 'Zyra', 'Senna'],
  Caitlyn: ['Lux', 'Morgana', 'Karma', 'Zyra', 'Xerath'],
  Draven: ['Leona', 'Nautilus', 'Thresh', 'Blitzcrank', 'Alistar'],
  Lucian: ['Nami', 'Braum', 'Thresh', 'Alistar', 'Soraka'],
  Tristana: ['Alistar', 'Leona', 'Nautilus', 'Thresh', 'Blitzcrank'],
  Ashe: ['Zyra', 'Xerath', 'Lux', 'Leona', 'Braum'],
  Samira: ['Nautilus', 'Leona', 'Alistar', 'Thresh', 'Rell'],
  Xayah: ['Rakan', 'Thresh', 'Nami', 'Braum', 'Leona'],
  Aphelios: ['Thresh', 'Lulu', 'Nautilus', 'Leona', 'Braum'],
  Twitch: ['Lulu', 'Yuumi', 'Rakan', 'Thresh', 'Nami'],
  Kogmaw: ['Lulu', 'Janna', 'Braum', 'Nami', 'Soraka'],
  Sivir: ['Yuumi', 'Karma', 'Lulu', 'Janna', 'Thresh'],
  Varus: ['Thresh', 'Xerath', 'Zyra', 'Leona', 'Lux'],
  Zeri: ['Lulu', 'Yuumi', 'Nami', 'Janna', 'Thresh'],
  // Supports
  Thresh: ['Lucian', 'Draven', 'Kaisa', 'Samira', 'Jinx'],
  Nautilus: ['Kaisa', 'Samira', 'Draven', 'Tristana', 'Jinx'],
  Leona: ['MissFortune', 'Samira', 'Draven', 'Tristana', 'Kaisa'],
  Lulu: ['Kogmaw', 'Twitch', 'Vayne', 'Jinx', 'Zeri'],
  Nami: ['Lucian', 'Ezreal', 'Jinx', 'Vayne', 'Jhin'],
  Blitzcrank: ['Draven', 'Samira', 'Tristana', 'Lucian', 'MissFortune'],
  Alistar: ['Kaisa', 'Tristana', 'Samira', 'Draven', 'Lucian'],
  Braum: ['Lucian', 'Kaisa', 'Ashe', 'Vayne', 'Kogmaw'],
  Rakan: ['Xayah', 'Kaisa', 'Twitch', 'Samira', 'MissFortune'],
  Morgana: ['Caitlyn', 'Jhin', 'MissFortune', 'Varus', 'Ashe'],
  Soraka: ['Vayne', 'Kogmaw', 'Lucian', 'Jinx', 'Sivir'],
  Janna: ['Vayne', 'Kogmaw', 'Jinx', 'Sivir', 'Zeri'],
  Yuumi: ['Ezreal', 'Sivir', 'Twitch', 'Zeri', 'Kogmaw'],
  Senna: ['Tahm Kench', 'MissFortune', 'Jhin', 'Ashe', 'Seraphine'],
  // Solo laners with jungle synergy
  Yasuo: ['Malphite', 'Diana', 'Yone', 'Gragas', 'Alistar'],
  Yone: ['Malphite', 'Diana', 'Yasuo', 'Gragas', 'Alistar'],
  // Jungle + laner combos
  Jarvan: ['Galio', 'Orianna', 'Yasuo', 'MissFortune', 'Rumble'],
  Amumu: ['MissFortune', 'Yasuo', 'Orianna', 'Katarina', 'Kennen'],
};

// --- API calls ---
async function fetchSummoner(puuid) {
  const res = await fetch(`/api/riot/summoner?puuid=${encodeURIComponent(puuid)}`);
  if (!res.ok) throw new Error(`Summoner API error: ${res.status}`);
  return res.json();
}

async function fetchMastery(puuid, count = 10) {
  const res = await fetch(`/api/riot/mastery?puuid=${encodeURIComponent(puuid)}&count=${count}`);
  if (!res.ok) throw new Error(`Mastery API error: ${res.status}`);
  return res.json();
}

async function fetchMatchIds(puuid, count = 10) {
  const res = await fetch(`/api/riot/matches?puuid=${encodeURIComponent(puuid)}&count=${count}&type=ranked`);
  if (!res.ok) throw new Error(`Matches API error: ${res.status}`);
  return res.json();
}

async function fetchMatchDetail(matchId) {
  const res = await fetch(`/api/riot/match/${encodeURIComponent(matchId)}`);
  if (!res.ok) throw new Error(`Match detail API error: ${res.status}`);
  return res.json();
}

// --- Orchestrator ---
export async function fetchFullPlayerData(puuid, onProgress) {
  const steps = { total: 0, done: 0 };
  const report = (label) => {
    steps.done++;
    if (onProgress) onProgress(steps.done, steps.total, label);
  };

  onProgress?.(0, 1, 'Chargement des donnees...');
  const [summonerData, masteryData, matchIds] = await Promise.all([
    fetchSummoner(puuid),
    fetchMastery(puuid, 10),
    fetchMatchIds(puuid, 10),
  ]);

  steps.total = 3 + matchIds.length;
  steps.done = 3;
  report('Donnees de base chargees');

  const matchesData = [];
  for (let i = 0; i < matchIds.length; i++) {
    const match = await fetchMatchDetail(matchIds[i]);
    matchesData.push(match);
    report(`Match ${i + 1}/${matchIds.length} charge`);
  }

  return { summonerData, masteryData, matchIds, matchesData };
}

// --- Extract comprehensive player stats from a single match ---
export function extractPlayerStats(matchData, puuid) {
  const p = matchData.info.participants.find(pp => pp.puuid === puuid);
  if (!p) return null;

  const dur = matchData.info.gameDuration;
  const durMin = dur / 60;
  const teamId = p.teamId;
  const teammates = matchData.info.participants.filter(pp => pp.teamId === teamId);
  const teamDamage = teammates.reduce((s, pp) => s + pp.totalDamageDealtToChampions, 0);
  const teamKills = teammates.reduce((s, pp) => s + pp.kills, 0);

  return {
    // Basic identity
    championName: p.championName,
    teamPosition: p.teamPosition || p.individualPosition || 'UNKNOWN',
    win: p.win,
    gameDurationMinutes: durMin,
    gameCreation: matchData.info.gameCreation,

    // KDA
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    killParticipation: teamKills > 0 ? (p.kills + p.assists) / teamKills : 0,

    // Farm
    totalMinionsKilled: p.totalMinionsKilled,
    neutralMinionsKilled: p.neutralMinionsKilled,
    csPerMin: durMin > 0 ? (p.totalMinionsKilled + p.neutralMinionsKilled) / durMin : 0,

    // Vision
    visionScore: p.visionScore,
    wardsPlaced: p.wardsPlaced,
    wardsKilled: p.wardsKilled || 0,
    controlWardsBought: p.visionWardsBoughtInGame || 0,
    visionPerMin: durMin > 0 ? p.visionScore / durMin : 0,

    // Damage
    totalDamageDealtToChampions: p.totalDamageDealtToChampions,
    physicalDamage: p.physicalDamageDealtToChampions || 0,
    magicDamage: p.magicDamageDealtToChampions || 0,
    trueDamage: p.trueDamageDealtToChampions || 0,
    damageShare: teamDamage > 0 ? p.totalDamageDealtToChampions / teamDamage : 0,
    damagePerMin: durMin > 0 ? p.totalDamageDealtToChampions / durMin : 0,
    damageTaken: p.totalDamageTaken || 0,
    damageTakenPerMin: durMin > 0 ? (p.totalDamageTaken || 0) / durMin : 0,

    // Gold
    goldEarned: p.goldEarned,
    goldPerMin: durMin > 0 ? p.goldEarned / durMin : 0,

    // Objectives
    turretKills: p.turretKills || 0,
    inhibitorKills: p.inhibitorKills || 0,
    dragonKills: p.dragonKills || 0,
    baronKills: p.baronKills || 0,

    // First blood / tower
    firstBloodKill: p.firstBloodKill || false,
    firstBloodAssist: p.firstBloodAssist || false,
    firstTowerKill: p.firstTowerKill || false,
    firstTowerAssist: p.firstTowerAssist || false,

    // Multi-kills
    doubleKills: p.doubleKills || 0,
    tripleKills: p.tripleKills || 0,
    quadraKills: p.quadraKills || 0,
    pentaKills: p.pentaKills || 0,

    // Survivability
    longestTimeSpentLiving: p.longestTimeSpentLiving || 0,

    // CC
    totalTimeCCDealt: p.totalTimeCCDealt || 0,
    timeCCingOthers: p.timeCCingOthers || 0,

    // Utility
    totalHealsOnTeammates: p.totalHealsOnTeammates || 0,
    totalDamageShieldedOnTeammates: p.totalDamageShieldedOnTeammates || 0,

    // Challenges (optional fields)
    soloKills: p.challenges?.soloKills || 0,
    turretPlatesTaken: p.challenges?.turretPlatesTaken || 0,
    laneMinionsFirst10Min: p.challenges?.laneMinionsFirst10Minutes || 0,

    // Items
    items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],

    // Teammates for synergy analysis
    _teammates: teammates
      .filter(t => t.puuid !== puuid)
      .map(t => ({ championName: t.championName, position: t.teamPosition })),
  };
}

// --- Aggregate analytics ---
export function computeAnalytics(statsList, masteryData, summonerData, rankTier) {
  const validStats = statsList.filter(Boolean);
  const totalGames = validStats.length;

  if (totalGames === 0) {
    return emptyAnalytics(summonerData);
  }

  const wins = validStats.filter(s => s.win).length;
  const winrate = (wins / totalGames) * 100;

  const totalKills = validStats.reduce((s, v) => s + v.kills, 0);
  const totalDeaths = validStats.reduce((s, v) => s + v.deaths, 0);
  const totalAssists = validStats.reduce((s, v) => s + v.assists, 0);
  const avgKDA = totalDeaths > 0 ? (totalKills + totalAssists) / totalDeaths : totalKills + totalAssists;

  const avg = (arr, fn) => arr.reduce((s, v) => s + fn(v), 0) / arr.length;

  const overview = {
    totalGames,
    winrate: rd1(winrate),
    avgKDA: rd2(avgKDA),
    avgKills: rd1(totalKills / totalGames),
    avgDeaths: rd1(totalDeaths / totalGames),
    avgAssists: rd1(totalAssists / totalGames),
    avgCSPerMin: rd1(avg(validStats, s => s.csPerMin)),
    avgVisionPerMin: rd2(avg(validStats, s => s.visionPerMin)),
    avgDamageShare: rd1(avg(validStats, s => s.damageShare) * 100),
    avgDeathsPerGame: rd1(totalDeaths / totalGames),
    avgKillParticipation: rd1(avg(validStats, s => s.killParticipation) * 100),
    avgGoldPerMin: rd0(avg(validStats, s => s.goldPerMin)),
    avgDamagePerMin: rd0(avg(validStats, s => s.damagePerMin)),
    avgDamageTakenPerMin: rd0(avg(validStats, s => s.damageTakenPerMin)),
    avgWardsPlaced: rd1(avg(validStats, s => s.wardsPlaced)),
    avgWardsKilled: rd1(avg(validStats, s => s.wardsKilled)),
    avgControlWardsBought: rd1(avg(validStats, s => s.controlWardsBought)),
    avgGameDuration: rd1(avg(validStats, s => s.gameDurationMinutes)),
    avgCCTime: rd1(avg(validStats, s => s.timeCCingOthers)),
  };

  // Damage composition
  const totalPhys = validStats.reduce((s, v) => s + v.physicalDamage, 0);
  const totalMagic = validStats.reduce((s, v) => s + v.magicDamage, 0);
  const totalTrue = validStats.reduce((s, v) => s + v.trueDamage, 0);
  const totalDmgAll = totalPhys + totalMagic + totalTrue;
  const damageComposition = {
    physical: totalDmgAll > 0 ? rd1((totalPhys / totalDmgAll) * 100) : 0,
    magic: totalDmgAll > 0 ? rd1((totalMagic / totalDmgAll) * 100) : 0,
    true: totalDmgAll > 0 ? rd1((totalTrue / totalDmgAll) * 100) : 0,
  };

  // Multi-kills & highlights
  const highlights = {
    doubleKills: validStats.reduce((s, v) => s + v.doubleKills, 0),
    tripleKills: validStats.reduce((s, v) => s + v.tripleKills, 0),
    quadraKills: validStats.reduce((s, v) => s + v.quadraKills, 0),
    pentaKills: validStats.reduce((s, v) => s + v.pentaKills, 0),
    soloKills: validStats.reduce((s, v) => s + v.soloKills, 0),
    firstBloods: validStats.filter(s => s.firstBloodKill || s.firstBloodAssist).length,
    firstBloodRate: rd1((validStats.filter(s => s.firstBloodKill || s.firstBloodAssist).length / totalGames) * 100),
    firstTowers: validStats.filter(s => s.firstTowerKill || s.firstTowerAssist).length,
    turretPlatesTaken: validStats.reduce((s, v) => s + v.turretPlatesTaken, 0),
  };

  // Early game
  const earlyGame = {
    avgCSAt10: rd1(avg(validStats, s => s.laneMinionsFirst10Min)),
    firstBloodRate: highlights.firstBloodRate,
    avgTurretPlates: rd1(avg(validStats, s => s.turretPlatesTaken)),
    avgSoloKills: rd1(avg(validStats, s => s.soloKills)),
  };

  // By champion (enriched with per-game details)
  const byChampionRaw = {};
  for (const s of validStats) {
    if (!byChampionRaw[s.championName]) {
      byChampionRaw[s.championName] = {
        games: 0, wins: 0, kills: 0, deaths: 0, assists: 0,
        csPerMin: 0, damagePerMin: 0, goldPerMin: 0, visionPerMin: 0, kp: 0,
        physDmg: 0, magicDmg: 0, trueDmg: 0,
        soloKills: 0, firstBloods: 0, controlWards: 0,
        roles: {}, itemBuilds: [], matches: [],
      };
    }
    const c = byChampionRaw[s.championName];
    c.games++;
    if (s.win) c.wins++;
    c.kills += s.kills;
    c.deaths += s.deaths;
    c.assists += s.assists;
    c.csPerMin += s.csPerMin;
    c.damagePerMin += s.damagePerMin;
    c.goldPerMin += s.goldPerMin;
    c.visionPerMin += s.visionPerMin;
    c.kp += s.killParticipation;
    c.physDmg += s.physicalDamage;
    c.magicDmg += s.magicDamage;
    c.trueDmg += s.trueDamage;
    c.soloKills += s.soloKills;
    if (s.firstBloodKill || s.firstBloodAssist) c.firstBloods++;
    c.controlWards += s.controlWardsBought;
    // Role tracking
    const role = normalizeRole(s.teamPosition);
    c.roles[role] = (c.roles[role] || 0) + 1;
    // Items
    if (s.items) c.itemBuilds.push(s.items.filter(i => i > 0));
    // Per-game record
    c.matches.push({
      win: s.win,
      kills: s.kills, deaths: s.deaths, assists: s.assists,
      csPerMin: rd1(s.csPerMin), visionPerMin: rd2(s.visionPerMin),
      damageShare: rd1(s.damageShare * 100), kp: rd1(s.killParticipation * 100),
      duration: rd1(s.gameDurationMinutes), items: s.items || [],
      gameCreation: s.gameCreation,
    });
  }
  const byChampion = {};
  for (const [name, c] of Object.entries(byChampionRaw)) {
    const kda = c.deaths > 0 ? (c.kills + c.assists) / c.deaths : c.kills + c.assists;
    const totalDmg = c.physDmg + c.magicDmg + c.trueDmg;
    const mainRole = Object.entries(c.roles).sort((a, b) => b[1] - a[1])[0];
    // Most common items (count occurrences of each item ID across all games)
    const itemCounts = {};
    for (const build of c.itemBuilds) {
      for (const id of build) {
        if (id > 0) itemCounts[id] = (itemCounts[id] || 0) + 1;
      }
    }
    const topItems = Object.entries(itemCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id, count]) => ({ id: parseInt(id), count }));

    byChampion[name] = {
      games: c.games,
      winrate: rd1((c.wins / c.games) * 100),
      avgKDA: rd2(kda),
      avgCSPerMin: rd1(c.csPerMin / c.games),
      avgDamagePerMin: rd0(c.damagePerMin / c.games),
      avgGoldPerMin: rd0(c.goldPerMin / c.games),
      avgVisionPerMin: rd2(c.visionPerMin / c.games),
      avgKP: rd1((c.kp / c.games) * 100),
      avgKills: rd1(c.kills / c.games),
      avgDeaths: rd1(c.deaths / c.games),
      avgAssists: rd1(c.assists / c.games),
      // Enriched fields
      damageComp: {
        physical: totalDmg > 0 ? rd1((c.physDmg / totalDmg) * 100) : 0,
        magic: totalDmg > 0 ? rd1((c.magicDmg / totalDmg) * 100) : 0,
        true: totalDmg > 0 ? rd1((c.trueDmg / totalDmg) * 100) : 0,
      },
      mainRole: mainRole ? mainRole[0] : 'UNKNOWN',
      avgSoloKills: rd1(c.soloKills / c.games),
      firstBloodRate: rd1((c.firstBloods / c.games) * 100),
      avgControlWards: rd1(c.controlWards / c.games),
      topItems,
      matches: c.matches,
    };
  }

  // By role
  const byRole = {};
  for (const s of validStats) {
    const role = normalizeRole(s.teamPosition);
    if (!byRole[role]) { byRole[role] = { games: 0, wins: 0, kda: [] }; }
    byRole[role].games++;
    if (s.win) byRole[role].wins++;
    const kda = s.deaths > 0 ? (s.kills + s.assists) / s.deaths : s.kills + s.assists;
    byRole[role].kda.push(kda);
  }
  for (const [role, r] of Object.entries(byRole)) {
    const avgRoleKDA = r.kda.reduce((a, b) => a + b, 0) / r.kda.length;
    byRole[role] = {
      games: r.games,
      winrate: rd1((r.wins / r.games) * 100),
      avgKDA: rd2(avgRoleKDA),
    };
  }

  // Trends: recent 5 vs previous 5
  const recentGames = validStats.slice(0, 5);
  const previousGames = validStats.slice(5, 10);
  const recentWinrate = recentGames.length > 0
    ? rd1((recentGames.filter(s => s.win).length / recentGames.length) * 100) : 0;
  const previousWinrate = previousGames.length > 0
    ? rd1((previousGames.filter(s => s.win).length / previousGames.length) * 100) : 0;

  const recentKDA = recentGames.length > 0
    ? (recentGames.reduce((s, v) => s + v.kills + v.assists, 0)) / Math.max(1, recentGames.reduce((s, v) => s + v.deaths, 0)) : 0;
  const prevKDA = previousGames.length > 0
    ? (previousGames.reduce((s, v) => s + v.kills + v.assists, 0)) / Math.max(1, previousGames.reduce((s, v) => s + v.deaths, 0)) : 0;

  let kdaTrend = 'stable';
  if (recentKDA > prevKDA * 1.15) kdaTrend = 'improving';
  else if (recentKDA < prevKDA * 0.85) kdaTrend = 'declining';

  const recentCS = recentGames.length > 0 ? rd1(avg(recentGames, s => s.csPerMin)) : 0;
  const prevCS = previousGames.length > 0 ? rd1(avg(previousGames, s => s.csPerMin)) : 0;
  let csTrend = 'stable';
  if (recentCS > prevCS + 0.5) csTrend = 'improving';
  else if (recentCS < prevCS - 0.5) csTrend = 'declining';

  // Match history (compact)
  const matchHistory = validStats.map(s => ({
    champion: s.championName,
    win: s.win,
    kills: s.kills,
    deaths: s.deaths,
    assists: s.assists,
    csPerMin: rd1(s.csPerMin),
    visionPerMin: rd2(s.visionPerMin),
    damageShare: rd1(s.damageShare * 100),
    kp: rd1(s.killParticipation * 100),
    duration: rd1(s.gameDurationMinutes),
    role: normalizeRole(s.teamPosition),
    gameCreation: s.gameCreation,
  }));

  // Top champions from mastery
  const topChampions = (masteryData || []).slice(0, 10).map(m => ({
    championId: m.championId,
    championName: null,
    masteryLevel: m.championLevel,
    masteryPoints: m.championPoints,
  }));

  // Champion synergies
  const playerChamps = Object.keys(byChampion);
  const synergies = computeChampionSynergies(playerChamps, byRole);

  // Playstyle classification
  const playstyle = classifyPlaystyle(overview, byRole, highlights, earlyGame);

  // Strengths & weaknesses (enriched)
  const { strengths, weaknesses } = evaluateStrengthsWeaknesses(overview, rankTier, highlights, earlyGame, damageComposition);

  return {
    overview,
    damageComposition,
    highlights,
    earlyGame,
    byChampion,
    byRole,
    trends: { recentWinrate, previousWinrate, kdaTrend, recentCS, prevCS, csTrend },
    matchHistory,
    topChampions,
    synergies,
    playstyle,
    strengths,
    weaknesses,
    summonerLevel: summonerData?.summonerLevel || 0,
    profileIconId: summonerData?.profileIconId || 0,
  };
}

function emptyAnalytics(summonerData) {
  return {
    overview: { totalGames: 0, winrate: 0, avgKDA: 0, avgCSPerMin: 0, avgVisionPerMin: 0, avgDamageShare: 0, avgDeathsPerGame: 0, avgKillParticipation: 0, avgGoldPerMin: 0, avgDamagePerMin: 0, avgDamageTakenPerMin: 0, avgWardsPlaced: 0, avgWardsKilled: 0, avgControlWardsBought: 0, avgGameDuration: 0, avgCCTime: 0, avgKills: 0, avgDeaths: 0, avgAssists: 0 },
    damageComposition: { physical: 0, magic: 0, true: 0 },
    highlights: { doubleKills: 0, tripleKills: 0, quadraKills: 0, pentaKills: 0, soloKills: 0, firstBloods: 0, firstBloodRate: 0, firstTowers: 0, turretPlatesTaken: 0 },
    earlyGame: { avgCSAt10: 0, firstBloodRate: 0, avgTurretPlates: 0, avgSoloKills: 0 },
    byChampion: {}, byRole: {},
    trends: { recentWinrate: 0, previousWinrate: 0, kdaTrend: 'stable', recentCS: 0, prevCS: 0, csTrend: 'stable' },
    matchHistory: [], topChampions: [], synergies: [],
    playstyle: { type: 'unknown', tags: [], scores: {} },
    strengths: [], weaknesses: [],
    summonerLevel: summonerData?.summonerLevel || 0,
    profileIconId: summonerData?.profileIconId || 0,
  };
}

// --- Champion synergies based on player's champion pool ---
function computeChampionSynergies(playerChamps, byRole) {
  const synergyMap = {};

  for (const champ of playerChamps) {
    const synList = CHAMPION_SYNERGIES[champ];
    if (!synList) continue;
    for (const syn of synList) {
      if (!synergyMap[syn]) {
        synergyMap[syn] = { champion: syn, matchedWith: [], score: 0 };
      }
      synergyMap[syn].matchedWith.push(champ);
      synergyMap[syn].score += 1;
    }
  }

  return Object.values(synergyMap)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

// --- Playstyle classification ---
function classifyPlaystyle(overview, byRole, highlights, earlyGame) {
  const scores = {
    aggressive: 0,
    defensive: 0,
    farming: 0,
    teamplay: 0,
    vision: 0,
    earlyGame: 0,
  };

  // Aggressive: high kills, solo kills, damage, first bloods
  if (overview.avgKills >= 6) scores.aggressive += 3;
  else if (overview.avgKills >= 4) scores.aggressive += 2;
  if (overview.avgDamageShare >= 25) scores.aggressive += 2;
  if (highlights.firstBloodRate >= 30) scores.aggressive += 2;
  if (earlyGame.avgSoloKills >= 1) scores.aggressive += 2;

  // Defensive: low deaths, high survivability, damage taken
  if (overview.avgDeathsPerGame <= 3) scores.defensive += 3;
  else if (overview.avgDeathsPerGame <= 5) scores.defensive += 2;
  if (overview.avgDamageTakenPerMin >= 600) scores.defensive += 1;

  // Farming: high CS
  if (overview.avgCSPerMin >= 8) scores.farming += 3;
  else if (overview.avgCSPerMin >= 7) scores.farming += 2;
  else if (overview.avgCSPerMin >= 6) scores.farming += 1;

  // Teamplay: high KP, assists, utility
  if (overview.avgKillParticipation >= 70) scores.teamplay += 3;
  else if (overview.avgKillParticipation >= 60) scores.teamplay += 2;
  if (overview.avgAssists >= 8) scores.teamplay += 2;

  // Vision
  if (overview.avgVisionPerMin >= 0.8) scores.vision += 3;
  else if (overview.avgVisionPerMin >= 0.6) scores.vision += 2;
  if (overview.avgControlWardsBought >= 2) scores.vision += 1;

  // Early game
  if (earlyGame.firstBloodRate >= 30) scores.earlyGame += 2;
  if (earlyGame.avgTurretPlates >= 1.5) scores.earlyGame += 2;
  if (earlyGame.avgCSAt10 >= 70) scores.earlyGame += 2;

  const tags = [];
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const type = sorted[0][0];

  for (const [key, val] of sorted) {
    if (val >= 3) tags.push(key);
  }
  if (tags.length === 0 && sorted[0][1] >= 2) tags.push(sorted[0][0]);

  return { type, tags, scores };
}

// --- Resolve champion IDs to names ---
export async function resolveChampionNames(analytics) {
  const map = await getChampionMap();
  for (const champ of analytics.topChampions) {
    if (champ.championId && !champ.championName) {
      champ.championName = map[champ.championId] || `Champion${champ.championId}`;
    }
  }
  return analytics;
}

function normalizeRole(position) {
  const map = {
    'TOP': 'TOP', 'JUNGLE': 'JUNGLE', 'MIDDLE': 'MID', 'MID': 'MID',
    'BOTTOM': 'ADC', 'ADC': 'ADC', 'UTILITY': 'SUPPORT', 'SUPPORT': 'SUPPORT',
  };
  return map[(position || '').toUpperCase()] || 'UNKNOWN';
}

// --- Enriched benchmarks & evaluation ---
function getRankBenchmarkCS(rankTier) {
  const map = { IRON: 3.5, BRONZE: 4.5, SILVER: 5.5, GOLD: 6.5, PLATINUM: 7.25, EMERALD: 7.25, DIAMOND: 7.75, MASTER: 8, GRANDMASTER: 8, CHALLENGER: 8.5 };
  return map[rankTier] || 5.5;
}

export function evaluateStrengthsWeaknesses(overview, rankTier, highlights, earlyGame, damageComposition) {
  const strengths = [];
  const weaknesses = [];
  const rank = rankTier || 'SILVER';

  const csBench = getRankBenchmarkCS(rank);
  if (overview.avgCSPerMin >= csBench) {
    strengths.push({ key: 'cs', label: 'CS/min eleve', value: overview.avgCSPerMin, benchmark: csBench, desc: `Au-dessus de la moyenne ${rank}` });
  } else if (overview.avgCSPerMin < csBench - 1) {
    weaknesses.push({ key: 'cs', label: 'CS/min faible', value: overview.avgCSPerMin, benchmark: csBench, desc: `En dessous de la moyenne ${rank}` });
  }

  if (overview.avgKDA >= 4) {
    strengths.push({ key: 'kda', label: 'KDA excellent', value: overview.avgKDA, benchmark: 3, desc: 'Tres bon ratio kill/mort' });
  } else if (overview.avgKDA < 2) {
    weaknesses.push({ key: 'kda', label: 'KDA faible', value: overview.avgKDA, benchmark: 3, desc: 'Trop de morts par rapport aux kills' });
  }

  if (overview.avgVisionPerMin >= 0.7) {
    strengths.push({ key: 'vision', label: 'Vision de carte', value: overview.avgVisionPerMin, benchmark: 0.55, desc: 'Excellent controle de vision' });
  } else if (overview.avgVisionPerMin < 0.35) {
    weaknesses.push({ key: 'vision', label: 'Vision insuffisante', value: overview.avgVisionPerMin, benchmark: 0.55, desc: 'Achete plus de wards' });
  }

  if (overview.avgDeathsPerGame <= 3.5) {
    strengths.push({ key: 'deaths', label: 'Survie', value: overview.avgDeathsPerGame, benchmark: 5, desc: 'Peu de morts, bon positionnement' });
  } else if (overview.avgDeathsPerGame > 7) {
    weaknesses.push({ key: 'deaths', label: 'Trop de morts', value: overview.avgDeathsPerGame, benchmark: 5, desc: 'Travaille le positionnement' });
  }

  if (overview.winrate >= 57) {
    strengths.push({ key: 'winrate', label: 'Winrate eleve', value: overview.winrate, benchmark: 50, desc: 'Impact positif sur les games' });
  } else if (overview.winrate < 43) {
    weaknesses.push({ key: 'winrate', label: 'Winrate basse', value: overview.winrate, benchmark: 50, desc: 'Tendance a perdre les games' });
  }

  if (overview.avgKillParticipation >= 70) {
    strengths.push({ key: 'kp', label: 'Kill participation', value: overview.avgKillParticipation + '%', benchmark: '60%', desc: 'Tres implique dans les kills' });
  } else if (overview.avgKillParticipation < 45) {
    weaknesses.push({ key: 'kp', label: 'Kill participation faible', value: overview.avgKillParticipation + '%', benchmark: '60%', desc: 'Pas assez present dans les fights' });
  }

  if (overview.avgDamageShare >= 28) {
    strengths.push({ key: 'damage', label: 'Impact degats', value: overview.avgDamageShare + '%', benchmark: '20%', desc: 'Carry de l\'equipe en degats' });
  } else if (overview.avgDamageShare < 12) {
    weaknesses.push({ key: 'damage', label: 'Degats faibles', value: overview.avgDamageShare + '%', benchmark: '20%', desc: 'Pas assez de contribution' });
  }

  if (overview.avgGoldPerMin >= 450) {
    strengths.push({ key: 'gold', label: 'Gold/min', value: overview.avgGoldPerMin, benchmark: 380, desc: 'Excellent income d\'or' });
  } else if (overview.avgGoldPerMin < 300) {
    weaknesses.push({ key: 'gold', label: 'Gold/min faible', value: overview.avgGoldPerMin, benchmark: 380, desc: 'Manque de gold' });
  }

  if (highlights && highlights.firstBloodRate >= 40) {
    strengths.push({ key: 'firstblood', label: 'First blood', value: highlights.firstBloodRate + '%', benchmark: '20%', desc: 'Agressif en early' });
  }

  if (earlyGame && earlyGame.avgSoloKills >= 1.5) {
    strengths.push({ key: 'solokills', label: 'Solo kills', value: earlyGame.avgSoloKills, benchmark: 0.5, desc: 'Dominance en 1v1' });
  }

  if (overview.avgControlWardsBought >= 2.5) {
    strengths.push({ key: 'controlwards', label: 'Control wards', value: overview.avgControlWardsBought, benchmark: 1.5, desc: 'Bon investissement en vision' });
  } else if (overview.avgControlWardsBought < 0.5) {
    weaknesses.push({ key: 'controlwards', label: 'Pas de control wards', value: overview.avgControlWardsBought, benchmark: 1.5, desc: 'Achete des pinks !' });
  }

  return { strengths, weaknesses };
}

// --- LP estimation from match history ---
const TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const DIV_ORDER = ['IV', 'III', 'II', 'I'];

export function rankToLP(tier, division, lp) {
  if (!tier || tier === 'UNRANKED') return 0;
  if (tier === 'MASTER') return 2800 + (lp || 0);
  if (tier === 'GRANDMASTER') return 3200 + (lp || 0);
  if (tier === 'CHALLENGER') return 3600 + (lp || 0);
  const tierIdx = TIER_ORDER.indexOf(tier);
  if (tierIdx === -1) return 0;
  const divIdx = DIV_ORDER.indexOf(division || 'IV');
  return tierIdx * 400 + (divIdx >= 0 ? divIdx : 0) * 100 + (lp || 0);
}

export function lpToRankLabel(totalLP) {
  if (totalLP >= 3600) return 'Challenger';
  if (totalLP >= 3200) return 'Grandmaster';
  if (totalLP >= 2800) return 'Master';
  const tierIdx = Math.min(Math.floor(totalLP / 400), TIER_ORDER.length - 1);
  const remainder = totalLP - tierIdx * 400;
  const divIdx = Math.min(Math.floor(remainder / 100), 3);
  const tier = TIER_ORDER[tierIdx] || 'IRON';
  const div = DIV_ORDER[divIdx] || 'IV';
  const name = tier.charAt(0) + tier.slice(1).toLowerCase();
  return `${name} ${div}`;
}

export function estimateLPProgression(matchHistory, currentTier, currentDivision, currentLP) {
  const ranked = (matchHistory || []).filter(m => m.win !== undefined);
  if (ranked.length === 0) return [];
  const avgGain = 22;
  const avgLoss = 18;
  let lp = rankToLP(currentTier, currentDivision, currentLP || 0);
  const points = [{ lp, index: 0 }];
  // Work backwards from current LP
  for (let i = 0; i < ranked.length; i++) {
    const m = ranked[i];
    if (m.win) {
      lp -= avgGain; // before this win, LP was lower
    } else {
      lp += avgLoss; // before this loss, LP was higher
    }
    lp = Math.max(0, lp);
    points.unshift({ lp, index: i + 1 });
  }
  return points;
}

// --- Helpers ---
function rd0(v) { return Math.round(v); }
function rd1(v) { return Math.round(v * 10) / 10; }
function rd2(v) { return Math.round(v * 100) / 100; }
