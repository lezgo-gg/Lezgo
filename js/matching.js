import { getRankIndex } from './riot.js';

// --- Known complementary role pairings ---
const ROLE_COMPLEMENTS = {
  ADC: ['SUPPORT'],
  SUPPORT: ['ADC'],
  JUNGLE: ['TOP', 'MID'],
  TOP: ['JUNGLE', 'MID'],
  MID: ['JUNGLE', 'TOP'],
};

// --- Champion synergy database (same as analytics.js) ---
const CHAMPION_SYNERGIES = {
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
  Yasuo: ['Malphite', 'Diana', 'Yone', 'Gragas', 'Alistar'],
  Yone: ['Malphite', 'Diana', 'Yasuo', 'Gragas', 'Alistar'],
  Jarvan: ['Galio', 'Orianna', 'Yasuo', 'MissFortune', 'Rumble'],
  Amumu: ['MissFortune', 'Yasuo', 'Orianna', 'Katarina', 'Kennen'],
};

/**
 * Compute a realistic compatibility score between two profiles.
 * Returns { score: 0-100, details: [{ label, points, desc }] }
 *
 * Criteria breakdown (max 100):
 *  - Complementary roles:        20 pts
 *  - Rank proximity:             15 pts
 *  - Schedule overlap:           15 pts
 *  - Same play style:             5 pts
 *  - Champion synergies:         15 pts
 *  - Playstyle complementarity:  10 pts
 *  - S/W complementarity:        10 pts
 *  - Winrate & performance:      10 pts
 */
export function computeCompatibilityScore(myProfile, otherProfile) {
  let score = 0;
  const details = [];

  // 1. Complementary roles (max 20)
  const roleScore = computeRoleScore(myProfile.roles || [], otherProfile.roles || []);
  score += roleScore;
  if (roleScore >= 12) {
    details.push({ label: 'Roles complementaires', points: roleScore, desc: describeRoleMatch(myProfile.roles, otherProfile.roles) });
  }

  // 2. Rank proximity (max 15)
  const rankScore = computeRankScore(myProfile.rank_tier, otherProfile.rank_tier);
  score += rankScore;
  if (rankScore >= 8) {
    details.push({ label: 'Rank proche', points: rankScore });
  }

  // 3. Schedule overlap (max 15)
  const scheduleScore = computeScheduleScore(myProfile.schedule || [], otherProfile.schedule || []);
  score += scheduleScore;
  if (scheduleScore >= 5) {
    const common = (myProfile.schedule || []).filter(s => (otherProfile.schedule || []).includes(s)).length;
    details.push({ label: `${common} horaire${common > 1 ? 's' : ''} en commun`, points: scheduleScore });
  }

  // 4. Same play style (max 5)
  const styleScore = computeStyleScore(myProfile.play_style, otherProfile.play_style);
  score += styleScore;
  if (styleScore > 0) {
    details.push({ label: 'Meme style de jeu', points: styleScore });
  }

  // 5. Champion synergies (max 15)
  const champScore = computeChampionSynergyScore(myProfile.analytics, otherProfile.analytics);
  score += champScore.score;
  if (champScore.score >= 5 && champScore.pairs.length > 0) {
    details.push({ label: 'Synergies champion', points: champScore.score, desc: champScore.pairs.slice(0, 3).map(p => `${p[0]} + ${p[1]}`).join(', ') });
  }

  // 6. Playstyle complementarity (max 10)
  const playstyleScore = computePlaystyleScore(myProfile.analytics, otherProfile.analytics);
  score += playstyleScore.score;
  if (playstyleScore.score >= 4) {
    details.push({ label: 'Styles complementaires', points: playstyleScore.score, desc: playstyleScore.desc });
  }

  // 7. S/W complementarity (max 10)
  const swScore = computeSWScore(myProfile.analytics, otherProfile.analytics);
  score += swScore.score;
  if (swScore.score >= 4) {
    details.push({ label: 'Forces compensent faiblesses', points: swScore.score, desc: swScore.desc });
  }

  // 8. Performance quality (max 10)
  const perfScore = computePerformanceScore(myProfile.analytics, otherProfile.analytics);
  score += perfScore;
  if (perfScore >= 5) {
    details.push({ label: 'Bon niveau de jeu', points: perfScore });
  }

  return { score: Math.min(100, Math.round(score)), details };
}

// --- Role complementarity (max 20) ---
function computeRoleScore(myRoles, otherRoles) {
  let best = 0;
  for (const myRole of myRoles) {
    const complements = ROLE_COMPLEMENTS[myRole] || [];
    for (const otherRole of otherRoles) {
      if (complements.includes(otherRole)) {
        // Perfect complement (e.g. ADC+SUP)
        const isBottomLane = (myRole === 'ADC' && otherRole === 'SUPPORT') || (myRole === 'SUPPORT' && otherRole === 'ADC');
        best = Math.max(best, isBottomLane ? 20 : 16);
      } else if (myRole !== otherRole) {
        // Different roles but not primary complement
        best = Math.max(best, 10);
      }
      // Same role = 0
    }
  }
  return best;
}

function describeRoleMatch(myRoles, otherRoles) {
  for (const myRole of (myRoles || [])) {
    const complements = ROLE_COMPLEMENTS[myRole] || [];
    for (const otherRole of (otherRoles || [])) {
      if (complements.includes(otherRole)) {
        const names = { TOP: 'Top', JUNGLE: 'Jungle', MID: 'Mid', ADC: 'ADC', SUPPORT: 'Support' };
        return `${names[myRole] || myRole} + ${names[otherRole] || otherRole}`;
      }
    }
  }
  return '';
}

// --- Rank proximity (max 15) ---
function computeRankScore(myRank, otherRank) {
  const myIdx = getRankIndex(myRank);
  const otherIdx = getRankIndex(otherRank);
  if (myIdx === -1 || otherIdx === -1) return 5;

  const diff = Math.abs(myIdx - otherIdx);
  if (diff === 0) return 15;
  if (diff === 1) return 12;
  if (diff === 2) return 7;
  if (diff === 3) return 3;
  return 0;
}

// --- Schedule overlap (max 15) ---
function computeScheduleScore(mySchedule, otherSchedule) {
  const common = mySchedule.filter(s => otherSchedule.includes(s)).length;
  if (common >= 3) return 15;
  if (common === 2) return 10;
  if (common === 1) return 5;
  return 0;
}

// --- Play style match (max 5) ---
function computeStyleScore(myStyle, otherStyle) {
  if (!myStyle || !otherStyle) return 0;
  return myStyle === otherStyle ? 5 : 0;
}

// --- Champion synergy (max 15) ---
function computeChampionSynergyScore(myAnalytics, otherAnalytics) {
  if (!myAnalytics?.byChampion || !otherAnalytics?.byChampion) return { score: 0, pairs: [] };

  const myChamps = Object.keys(myAnalytics.byChampion);
  const otherChamps = Object.keys(otherAnalytics.byChampion);
  const pairs = [];

  for (const myC of myChamps) {
    const synList = CHAMPION_SYNERGIES[myC];
    if (!synList) continue;
    for (const otherC of otherChamps) {
      if (synList.includes(otherC)) {
        pairs.push([myC, otherC]);
      }
    }
  }

  // Also check reverse
  for (const otherC of otherChamps) {
    const synList = CHAMPION_SYNERGIES[otherC];
    if (!synList) continue;
    for (const myC of myChamps) {
      if (synList.includes(myC) && !pairs.some(p => (p[0] === myC && p[1] === otherC) || (p[0] === otherC && p[1] === myC))) {
        pairs.push([otherC, myC]);
      }
    }
  }

  // Unique pairs, score based on count
  const uniquePairs = [];
  const seen = new Set();
  for (const p of pairs) {
    const key = [p[0], p[1]].sort().join('+');
    if (!seen.has(key)) {
      seen.add(key);
      uniquePairs.push(p);
    }
  }

  let score = 0;
  if (uniquePairs.length >= 4) score = 15;
  else if (uniquePairs.length === 3) score = 12;
  else if (uniquePairs.length === 2) score = 9;
  else if (uniquePairs.length === 1) score = 5;

  return { score, pairs: uniquePairs };
}

// --- Playstyle complementarity (max 10) ---
function computePlaystyleScore(myAnalytics, otherAnalytics) {
  if (!myAnalytics?.playstyle?.scores || !otherAnalytics?.playstyle?.scores) {
    return { score: 0, desc: '' };
  }

  const my = myAnalytics.playstyle.scores;
  const other = otherAnalytics.playstyle.scores;

  let score = 0;
  const reasons = [];

  // Complementary: aggressive + defensive
  if (my.aggressive >= 4 && other.defensive >= 4) {
    score += 3;
    reasons.push('Aggressif + Defensif');
  } else if (my.defensive >= 4 && other.aggressive >= 4) {
    score += 3;
    reasons.push('Defensif + Aggressif');
  }

  // Complementary: farming carry + teamplay support
  if (my.farming >= 4 && other.teamplay >= 4) {
    score += 3;
    reasons.push('Farm carry + Teamplay');
  } else if (my.teamplay >= 4 && other.farming >= 4) {
    score += 3;
    reasons.push('Teamplay + Farm carry');
  }

  // Both have vision = good
  if (my.vision >= 3 && other.vision >= 3) {
    score += 2;
    reasons.push('Bonne vision des deux');
  }

  // Both early game = strong duo
  if (my.earlyGame >= 3 && other.earlyGame >= 3) {
    score += 2;
    reasons.push('Double early game');
  }

  // Shared teamplay = good coordination
  if (my.teamplay >= 3 && other.teamplay >= 3) {
    score += 2;
    reasons.push('Bonne coordination');
  }

  return { score: Math.min(10, score), desc: reasons.slice(0, 2).join(', ') };
}

// --- Strengths/Weaknesses complementarity (max 10) ---
function computeSWScore(myAnalytics, otherAnalytics) {
  if (!myAnalytics || !otherAnalytics) return { score: 0, desc: '' };

  const myWeakKeys = (myAnalytics.weaknesses || []).map(w => w.key);
  const otherStrengthKeys = (otherAnalytics.strengths || []).map(s => s.key);
  const otherWeakKeys = (otherAnalytics.weaknesses || []).map(w => w.key);
  const myStrengthKeys = (myAnalytics.strengths || []).map(s => s.key);

  const covered = [];

  // My weaknesses covered by their strengths
  for (const key of myWeakKeys) {
    if (otherStrengthKeys.includes(key)) {
      covered.push(key);
    }
  }
  // Their weaknesses covered by my strengths
  for (const key of otherWeakKeys) {
    if (myStrengthKeys.includes(key) && !covered.includes(key)) {
      covered.push(key);
    }
  }

  const keyLabels = {
    cs: 'CS', kda: 'KDA', vision: 'Vision', deaths: 'Survie', winrate: 'Winrate',
    kp: 'KP', damage: 'Degats', gold: 'Gold', firstblood: 'First blood',
    solokills: 'Solo kills', controlwards: 'Control wards',
  };

  const desc = covered.slice(0, 3).map(k => keyLabels[k] || k).join(', ');
  const score = Math.min(10, covered.length * 3);

  return { score, desc };
}

// --- Performance quality bonus (max 10) ---
function computePerformanceScore(myAnalytics, otherAnalytics) {
  if (!otherAnalytics?.overview) return 0;

  const o = otherAnalytics.overview;
  let score = 0;

  // Winrate bonus
  if (o.winrate >= 55) score += 3;
  else if (o.winrate >= 50) score += 2;

  // KDA bonus
  if (o.avgKDA >= 3.5) score += 3;
  else if (o.avgKDA >= 2.5) score += 1;

  // Low deaths
  if (o.avgDeathsPerGame <= 4) score += 2;

  // Good KP
  if (o.avgKillParticipation >= 65) score += 2;

  return Math.min(10, score);
}
