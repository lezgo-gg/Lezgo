import { supabase } from './supabase.js';
import {
  fetchFullPlayerData, extractPlayerStats, computeAnalytics, resolveChampionNames,
  getChampionIconUrl, getProfileIconUrl, getItemIconUrl, getSummonerSpellIconUrl,
  getRuneIconUrl, getQueueName, fetchMatchHistoryPage,
  estimateLPProgression, lpToRankLabel,
  getItemDetails, getSummonerSpellDetails, getRuneDetails,
} from './analytics.js';

let dashboardInitialized = false;
let currentProfile = null;
let currentUserId = null;
let onFindDuosCallback = null;

// Current analytics (for champion click handlers)
let currentAnalytics = null;

// Match history state
let mhPuuid = null;
let mhMatches = [];
let mhStart = 0;
let mhQueueFilter = '';
let mhLoading = false;

// ===== DETAIL POPUP (items, runes, summoner spells) =====
let detailPopupEl = null;

function ensureDetailPopup() {
  if (detailPopupEl) return detailPopupEl;
  detailPopupEl = document.createElement('div');
  detailPopupEl.className = 'detail-popup hidden';
  detailPopupEl.innerHTML = `
    <div class="detail-popup-header">
      <img class="detail-popup-icon" src="" alt="" />
      <div class="detail-popup-title">
        <span class="detail-popup-name"></span>
        <span class="detail-popup-sub"></span>
      </div>
    </div>
    <div class="detail-popup-desc"></div>
  `;
  document.body.appendChild(detailPopupEl);
  return detailPopupEl;
}

async function handleDetailClick(target) {
  const type = target.dataset.detailType;
  const id = parseInt(target.dataset.detailId);
  if (!type || !id) return;

  let data = null;
  if (type === 'item') {
    const d = await getItemDetails(id);
    if (d) data = { name: d.name, description: d.description, sub: d.gold ? `${d.gold.total} gold` : '', iconUrl: d.iconUrl };
  } else if (type === 'spell') {
    const d = await getSummonerSpellDetails(id);
    if (d) data = { name: d.name, description: d.description, sub: d.cooldown ? `Cooldown: ${d.cooldown}s` : '', iconUrl: d.iconUrl };
  } else if (type === 'rune') {
    const d = await getRuneDetails(id);
    if (d) data = { name: d.name, description: d.description, sub: d.treeName || (d.isTree ? 'Arbre de runes' : ''), iconUrl: d.iconUrl };
  }

  if (!data) return;

  const popup = ensureDetailPopup();
  popup.querySelector('.detail-popup-icon').src = data.iconUrl || '';
  popup.querySelector('.detail-popup-icon').style.display = data.iconUrl ? 'block' : 'none';
  popup.querySelector('.detail-popup-name').textContent = data.name;
  popup.querySelector('.detail-popup-sub').textContent = data.sub;
  popup.querySelector('.detail-popup-desc').innerHTML = data.description;
  popup.classList.remove('hidden');

  // Position near clicked element
  const rect = target.getBoundingClientRect();
  const pw = 300;
  requestAnimationFrame(() => {
    const ph = popup.offsetHeight;
    let left = rect.left + rect.width / 2 - pw / 2;
    let top = rect.bottom + 8;
    if (left < 8) left = 8;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - 8;
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  });
}

// Global click handler for detail popups
document.addEventListener('click', (e) => {
  const detailTarget = e.target.closest('.detail-clickable');
  if (detailTarget) {
    handleDetailClick(detailTarget);
    return;
  }
  // Close popup if clicking outside
  if (detailPopupEl && !detailPopupEl.classList.contains('hidden') && !detailPopupEl.contains(e.target)) {
    detailPopupEl.classList.add('hidden');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && detailPopupEl && !detailPopupEl.classList.contains('hidden')) {
    detailPopupEl.classList.add('hidden');
  }
});

// ===== PLAYER PROFILE (in-app view) =====
const playerProfileCache = new Map();
let viewingOtherPlayer = false;

export function isViewingOtherPlayer() {
  return viewingOtherPlayer;
}

async function fetchRankByPuuid(puuid) {
  const res = await fetch(`/api/riot/rank?puuid=${encodeURIComponent(puuid)}`);
  if (!res.ok) return [];
  return res.json();
}

async function showPlayerProfile(puuid, riotName, riotTag, preloadedAnalytics) {
  viewingOtherPlayer = true;

  // Navigate to profile view, force Analyse tab
  window._showView('view-profile');
  window._showProfileTab('tab-analyse');

  // Hide the "Profil" tab button
  const profilTab = document.querySelector('.profile-tab[data-tab="tab-form"]');
  if (profilTab) profilTab.classList.add('hidden');

  // Hide own-user action buttons
  document.getElementById('btn-analyze').classList.add('hidden');
  document.getElementById('btn-reanalyze').classList.add('hidden');
  document.getElementById('btn-find-duos').classList.add('hidden');
  document.getElementById('last-analyzed-label').classList.add('hidden');

  // Show back button
  const backBtn = document.getElementById('btn-back-profile');
  backBtn.classList.remove('hidden');
  backBtn.onclick = () => restoreOwnProfile();

  // Populate header immediately
  const nameEl = document.getElementById('dashboard-riot-name');
  const rankEl = document.getElementById('dashboard-rank');
  const levelEl = document.getElementById('dashboard-level');
  const iconEl = document.getElementById('dashboard-icon');
  nameEl.textContent = `${riotName || ''}#${riotTag || ''}`;
  rankEl.textContent = '';
  rankEl.className = 'dashboard-rank';
  levelEl.textContent = '';
  iconEl.src = '';

  // Check cache
  if (playerProfileCache.has(puuid)) {
    const cached = playerProfileCache.get(puuid);
    applyPlayerProfileData(cached);
    return;
  }

  // If preloaded analytics (e.g. from DuoFind DB), use them directly
  if (preloadedAnalytics) {
    const data = { riotName, riotTag, puuid, analytics: preloadedAnalytics };
    applyPlayerProfileData(data);
    playerProfileCache.set(puuid, data);
    return;
  }

  // Show progress
  const progressDiv = document.getElementById('analysis-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressLabel = document.getElementById('progress-label');
  progressDiv.classList.remove('hidden');
  progressFill.style.width = '5%';
  progressLabel.textContent = 'Recuperation des donnees...';

  const setProgress = (pct, label) => {
    progressFill.style.width = `${pct}%`;
    progressLabel.textContent = label;
  };

  try {
    // Phase 1: summoner + rank
    setProgress(10, 'Chargement invocateur et rang...');
    const [summonerData, rankEntries] = await Promise.all([
      fetch(`/api/riot/summoner?puuid=${encodeURIComponent(puuid)}`).then(r => r.ok ? r.json() : null),
      fetchRankByPuuid(puuid),
    ]);

    const soloQueue = Array.isArray(rankEntries) ? rankEntries.find(e => e.queueType === 'RANKED_SOLO_5x5') : null;
    const rankTier = soloQueue ? soloQueue.tier : 'UNRANKED';
    const rankDivision = soloQueue ? soloQueue.rank : null;
    const summonerLevel = summonerData?.summonerLevel || 0;
    const profileIconId = summonerData?.profileIconId || 0;

    // Update header with rank info
    rankEl.textContent = formatRank(rankTier, rankDivision);
    rankEl.className = `dashboard-rank rank-${rankTier || 'UNRANKED'}`;
    if (summonerLevel) levelEl.textContent = `Niveau ${summonerLevel}`;
    if (profileIconId) {
      try { iconEl.src = await getProfileIconUrl(profileIconId); } catch { /* */ }
    }

    setProgress(25, 'Chargement des matchs...');

    // Phase 2: mastery + matches
    const { masteryData, matchesData } = await fetchFullPlayerData(puuid, (done, total, label) => {
      const pct = 25 + Math.round((done / Math.max(total, 1)) * 60);
      setProgress(pct, label);
    });

    setProgress(90, 'Calcul des statistiques...');

    const statsList = matchesData.map(m => extractPlayerStats(m, puuid));
    let analytics = computeAnalytics(statsList, masteryData, summonerData, rankTier);
    analytics = await resolveChampionNames(analytics);

    setProgress(100, 'Profil pret');

    const data = {
      riotName, riotTag, puuid, analytics,
      rankTier, rankDivision, summonerLevel, profileIconId,
    };
    playerProfileCache.set(puuid, data);
    applyPlayerProfileData(data);

  } catch (err) {
    console.error('Player profile error:', err);
    window.showToast('Impossible de charger le profil: ' + err.message, 'error');
  } finally {
    progressDiv.classList.add('hidden');
  }
}

function applyPlayerProfileData(data) {
  const { riotName, riotTag, puuid, analytics, rankTier, rankDivision, summonerLevel, profileIconId } = data;

  const nameEl = document.getElementById('dashboard-riot-name');
  const rankEl = document.getElementById('dashboard-rank');
  const levelEl = document.getElementById('dashboard-level');
  const iconEl = document.getElementById('dashboard-icon');

  nameEl.textContent = `${riotName || ''}#${riotTag || ''}`;
  if (rankTier) {
    rankEl.textContent = formatRank(rankTier, rankDivision);
    rankEl.className = `dashboard-rank rank-${rankTier || 'UNRANKED'}`;
  }
  if (summonerLevel) levelEl.textContent = `Niveau ${summonerLevel}`;
  if (profileIconId) {
    getProfileIconUrl(profileIconId).then(url => { iconEl.src = url; }).catch(() => {});
  }

  const ctaEl = document.getElementById('dashboard-cta');
  const analyticsEl = document.getElementById('dashboard-analytics');

  if (analytics && analytics.overview && analytics.overview.totalGames > 0) {
    ctaEl.classList.add('hidden');
    analyticsEl.classList.remove('hidden');
    renderAnalytics(analytics, {
      riot_game_name: riotName,
      riot_tag_line: riotTag,
      riot_puuid: puuid,
      rank_tier: rankTier,
      rank_division: rankDivision,
      analytics,
    });
  } else {
    ctaEl.classList.remove('hidden');
    analyticsEl.classList.add('hidden');
  }

  // Match history
  const mhSection = document.getElementById('match-history-section');
  if (puuid) {
    mhSection.classList.remove('hidden');
    initMatchHistory(puuid);
  } else {
    mhSection.classList.add('hidden');
  }
}

export function restoreOwnProfile() {
  viewingOtherPlayer = false;

  // Show the "Profil" tab button again
  const profilTab = document.querySelector('.profile-tab[data-tab="tab-form"]');
  if (profilTab) profilTab.classList.remove('hidden');

  // Restore own-user action buttons visibility (renderDashboard will set correct state)
  document.getElementById('btn-analyze').classList.remove('hidden');
  document.getElementById('btn-reanalyze').classList.remove('hidden');
  document.getElementById('btn-find-duos').classList.remove('hidden');
  document.getElementById('last-analyzed-label').classList.remove('hidden');

  // Hide back button
  const backBtn = document.getElementById('btn-back-profile');
  backBtn.classList.add('hidden');
  backBtn.onclick = null;

  // Re-render own profile
  if (currentProfile) {
    renderDashboard(currentProfile);
  }
}

// Player link click: check DuoFind profile first, fallback to in-app profile
document.addEventListener('click', async (e) => {
  const link = e.target.closest('a.mh-player-link');
  if (!link) return;

  e.preventDefault();

  const riotName = link.dataset.riotName;
  const riotTag = link.dataset.riotTag;
  const puuid = link.dataset.puuid;
  const opggUrl = link.href;

  // Check if this player has a DuoFind profile (with analytics)
  if (riotName && riotTag) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('riot_game_name', riotName)
        .eq('riot_tag_line', riotTag)
        .limit(1);

      if (!error && data && data.length > 0 && data[0].riot_puuid) {
        const profile = data[0];
        // Use DuoFind analytics if available (no re-fetch needed)
        if (profile.analytics && profile.analytics.overview && profile.analytics.overview.totalGames > 0) {
          showPlayerProfile(profile.riot_puuid, riotName, riotTag, profile.analytics);
        } else {
          showPlayerProfile(profile.riot_puuid, riotName, riotTag);
        }
        return;
      }
    } catch { /* fallback */ }
  }

  // Show in-app profile by fetching from Riot API
  if (puuid) {
    showPlayerProfile(puuid, riotName || '', riotTag || '');
  } else if (riotName && riotTag) {
    // Resolve puuid via verify-riot
    try {
      const res = await fetch('/api/verify-riot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameName: riotName, tagLine: riotTag }),
      });
      if (res.ok) {
        const result = await res.json();
        if (result.puuid) {
          showPlayerProfile(result.puuid, riotName, riotTag);
          return;
        }
      }
    } catch { /* fallback */ }
    window.open(opggUrl, '_blank');
  } else {
    window.open(opggUrl, '_blank');
  }
});

export function initDashboard(userId, profile, onFindDuos) {
  currentUserId = userId;
  currentProfile = profile;
  onFindDuosCallback = onFindDuos;

  if (!dashboardInitialized) {
    dashboardInitialized = true;

    document.getElementById('btn-analyze').addEventListener('click', () => {
      triggerAnalysis(currentProfile.riot_puuid, currentUserId);
    });

    document.getElementById('btn-reanalyze').addEventListener('click', () => {
      triggerAnalysis(currentProfile.riot_puuid, currentUserId);
    });

    document.getElementById('btn-find-duos').addEventListener('click', () => {
      if (onFindDuosCallback) onFindDuosCallback();
    });

    // Match history: queue filter tabs
    document.querySelectorAll('.mh-queue-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.mh-queue-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        mhQueueFilter = tab.dataset.queue || '';
        mhMatches = [];
        mhStart = 0;
        document.getElementById('match-history-list').innerHTML = '';
        loadMatchHistoryPage();
      });
    });

    // Load more button
    document.getElementById('btn-load-more-matches').addEventListener('click', () => {
      loadMatchHistoryPage();
    });

    // Champion detail modal close
    document.getElementById('modal-champion-close').addEventListener('click', () => {
      document.getElementById('modal-champion').classList.add('hidden');
    });
    document.querySelector('#modal-champion .modal-backdrop').addEventListener('click', () => {
      document.getElementById('modal-champion').classList.add('hidden');
    });
  }

  renderDashboard(profile);
}

export function updateDashboardProfile(profile) {
  currentProfile = profile;
  renderDashboard(profile);
}

async function renderDashboard(profile) {
  if (!profile) return;

  // Header
  const nameEl = document.getElementById('dashboard-riot-name');
  const rankEl = document.getElementById('dashboard-rank');
  const levelEl = document.getElementById('dashboard-level');
  const iconEl = document.getElementById('dashboard-icon');

  nameEl.textContent = `${profile.riot_game_name}#${profile.riot_tag_line}`;
  rankEl.textContent = formatRank(profile.rank_tier, profile.rank_division);
  rankEl.className = `dashboard-rank rank-${profile.rank_tier || 'UNRANKED'}`;

  // Always prefer LoL profile icon over Discord avatar
  let avatarSet = false;
  if (profile.profile_icon_id) {
    try {
      iconEl.src = await getProfileIconUrl(profile.profile_icon_id);
      avatarSet = true;
    } catch { /* fallback below */ }
  }
  if (!avatarSet && profile.riot_puuid) {
    try {
      const sumRes = await fetch(`/api/riot/summoner?puuid=${encodeURIComponent(profile.riot_puuid)}`);
      if (sumRes.ok) {
        const sumData = await sumRes.json();
        if (sumData.profileIconId) {
          profile.profile_icon_id = sumData.profileIconId;
          iconEl.src = await getProfileIconUrl(sumData.profileIconId);
          avatarSet = true;
          // Persist to DB
          supabase.from('profiles').update({
            profile_icon_id: sumData.profileIconId,
            summoner_level: sumData.summonerLevel || profile.summoner_level,
          }).eq('id', currentUserId);
          if (sumData.summonerLevel) profile.summoner_level = sumData.summonerLevel;
        }
      }
    } catch { /* fallback below */ }
  }
  if (!avatarSet && profile.discord_avatar) {
    iconEl.src = profile.discord_avatar;
  }

  if (profile.summoner_level) {
    levelEl.textContent = `Niveau ${profile.summoner_level}`;
  } else {
    levelEl.textContent = '';
  }

  const analytics = profile.analytics;
  const ctaEl = document.getElementById('dashboard-cta');
  const analyticsEl = document.getElementById('dashboard-analytics');

  // Action bar state
  const analyzeBtn = document.getElementById('btn-analyze');
  const reanalyzeBtn = document.getElementById('btn-reanalyze');
  const findDuosBtn = document.getElementById('btn-find-duos');

  if (analytics && analytics.overview && analytics.overview.totalGames > 0) {
    ctaEl.classList.add('hidden');
    analyticsEl.classList.remove('hidden');
    analyzeBtn.classList.add('hidden');
    reanalyzeBtn.classList.remove('hidden');
    findDuosBtn.classList.remove('hidden');
    renderAnalytics(analytics, profile);
  } else {
    ctaEl.classList.remove('hidden');
    analyticsEl.classList.add('hidden');
    analyzeBtn.classList.remove('hidden');
    reanalyzeBtn.classList.add('hidden');
    findDuosBtn.classList.add('hidden');
  }

  // Always show match history if puuid exists
  const mhSection = document.getElementById('match-history-section');
  if (profile.riot_puuid) {
    mhSection.classList.remove('hidden');
    initMatchHistory(profile.riot_puuid);
  } else {
    mhSection.classList.add('hidden');
  }
}

async function renderAnalytics(analytics, profile) {
  currentAnalytics = analytics;
  const o = analytics.overview;

  // --- LP Progression Chart ---
  await renderLPChart(analytics, profile);

  // --- Stats row 1: Core ---
  const statsRow = document.getElementById('stats-row');
  statsRow.innerHTML = `
    ${statCard(o.winrate + '%', 'Winrate', wrClass(o.winrate))}
    ${statCard(o.avgKDA, 'KDA', kdaClass(o.avgKDA))}
    ${statCard(o.avgCSPerMin, 'CS/min', csClass(o.avgCSPerMin))}
    ${statCard(o.avgVisionPerMin, 'Vision/min', visClass(o.avgVisionPerMin))}
    ${statCard(o.avgDamageShare + '%', 'Degats', dmgClass(o.avgDamageShare))}
  `;

  // --- Stats row 2: Extended ---
  const statsRow2 = document.getElementById('stats-row-2');
  statsRow2.innerHTML = `
    ${statCard(o.avgGoldPerMin, 'Gold/min', o.avgGoldPerMin >= 400 ? 'stat-good' : o.avgGoldPerMin >= 320 ? 'stat-neutral' : 'stat-bad')}
    ${statCard(o.avgKillParticipation + '%', 'Kill Participation', o.avgKillParticipation >= 65 ? 'stat-good' : o.avgKillParticipation >= 50 ? 'stat-neutral' : 'stat-bad')}
    ${statCard(o.avgDamagePerMin, 'Degats/min', o.avgDamagePerMin >= 600 ? 'stat-good' : o.avgDamagePerMin >= 400 ? 'stat-neutral' : 'stat-bad')}
    ${statCard(o.avgDeathsPerGame, 'Morts/game', o.avgDeathsPerGame <= 4 ? 'stat-good' : o.avgDeathsPerGame <= 6 ? 'stat-neutral' : 'stat-bad')}
    ${statCard(o.avgControlWardsBought, 'Control Wards', o.avgControlWardsBought >= 2 ? 'stat-good' : o.avgControlWardsBought >= 1 ? 'stat-neutral' : 'stat-bad')}
  `;

  // --- Strengths & Weaknesses ---
  renderStrengthsWeaknesses(analytics);

  // --- Playstyle Profile ---
  renderPlaystyle(analytics.playstyle);

  // --- Champion Pool ---
  await renderChampionPool(analytics);

  // --- Champion Synergies ---
  await renderChampionSynergies(analytics.synergies);

  // --- Damage Composition ---
  renderDamageComposition(analytics.damageComposition);

  // --- Roles ---
  renderRoles(analytics.byRole);

  // --- Early Game ---
  renderEarlyGame(analytics.earlyGame);

  // --- Trends ---
  renderTrends(analytics.trends);

  // --- Last analyzed ---
  const lastLabel = document.getElementById('last-analyzed-label');
  if (profile.last_analyzed_at) {
    const d = new Date(profile.last_analyzed_at);
    lastLabel.textContent = `Derniere analyse : ${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  }
}

// ===== SECTION RENDERERS =====

function renderStrengthsWeaknesses(analytics) {
  const strengthsList = document.getElementById('strengths-list');
  strengthsList.innerHTML = (analytics.strengths || []).map(s =>
    `<li class="sw-item sw-strength">
      <span class="sw-icon">&#9650;</span>
      <div class="sw-text">
        <span class="sw-label">${esc(s.label)}</span>
        ${s.desc ? `<span class="sw-desc">${esc(s.desc)}</span>` : ''}
      </div>
      <span class="sw-value">${s.value} <span class="sw-bench">(ref: ${s.benchmark})</span></span>
    </li>`
  ).join('') || '<li class="sw-empty">Aucune force identifiee</li>';

  const weaknessesList = document.getElementById('weaknesses-list');
  weaknessesList.innerHTML = (analytics.weaknesses || []).map(w =>
    `<li class="sw-item sw-weakness">
      <span class="sw-icon">&#9660;</span>
      <div class="sw-text">
        <span class="sw-label">${esc(w.label)}</span>
        ${w.desc ? `<span class="sw-desc">${esc(w.desc)}</span>` : ''}
      </div>
      <span class="sw-value">${w.value} <span class="sw-bench">(ref: ${w.benchmark})</span></span>
    </li>`
  ).join('') || '<li class="sw-empty">Aucune faiblesse identifiee</li>';
}

function renderPlaystyle(playstyle) {
  const container = document.getElementById('playstyle-profile');
  if (!playstyle || !playstyle.scores) {
    container.innerHTML = '<p class="empty-note">Pas de profil de jeu</p>';
    return;
  }

  const axes = [
    { key: 'aggressive', label: 'Agressivite', icon: '&#9876;', color: 'var(--error)' },
    { key: 'defensive', label: 'Defensive', icon: '&#128737;', color: 'var(--blue)' },
    { key: 'farming', label: 'Farming', icon: '&#127805;', color: 'var(--gold)' },
    { key: 'teamplay', label: 'Teamplay', icon: '&#129309;', color: 'var(--success)' },
    { key: 'vision', label: 'Vision', icon: '&#128065;', color: 'var(--rank-diamond)' },
    { key: 'earlyGame', label: 'Early Game', icon: '&#9889;', color: 'var(--rank-grandmaster)' },
  ];

  const maxScore = 9;
  const typeLabels = {
    aggressive: 'Joueur Agressif',
    defensive: 'Joueur Defensif',
    farming: 'Joueur Farm',
    teamplay: 'Joueur Team',
    vision: 'Vision Pro',
    earlyGame: 'Early Gamer',
    unknown: 'Style Mixte',
  };

  const tags = (playstyle.tags || []).map(t => {
    const axis = axes.find(a => a.key === t);
    return axis ? `<span class="playstyle-tag" style="color:${axis.color};border-color:${axis.color}">${axis.label}</span>` : '';
  }).join('');

  container.innerHTML = `
    <div class="playstyle-header">
      <span class="playstyle-type">${typeLabels[playstyle.type] || 'Style Mixte'}</span>
      <div class="playstyle-tags">${tags}</div>
    </div>
    <div class="playstyle-bars">
      ${axes.map(a => {
        const val = playstyle.scores[a.key] || 0;
        const pct = Math.round((val / maxScore) * 100);
        return `
          <div class="playstyle-bar-row">
            <span class="playstyle-bar-icon">${a.icon}</span>
            <span class="playstyle-bar-label">${a.label}</span>
            <div class="playstyle-bar-track">
              <div class="playstyle-bar-fill" style="width:${pct}%;background:${a.color}"></div>
            </div>
            <span class="playstyle-bar-val">${val}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function renderChampionPool(analytics) {
  const champPool = document.getElementById('champion-pool');
  const champEntries = Object.entries(analytics.byChampion || {})
    .sort((a, b) => b[1].games - a[1].games);

  if (champEntries.length === 0) {
    champPool.innerHTML = '<p class="empty-note">Aucun champion joue</p>';
    return;
  }

  const parts = [];
  for (const [name, d] of champEntries) {
    let iconUrl = '';
    try { iconUrl = await getChampionIconUrl(name); } catch { /* fallback */ }
    const wrCls = d.winrate >= 55 ? 'champ-wr-good' : d.winrate < 45 ? 'champ-wr-bad' : '';
    parts.push(`
      <div class="champ-card-ext">
        <img class="champ-icon" src="${iconUrl}" alt="${esc(name)}" onerror="this.style.display='none'" />
        <div class="champ-info">
          <span class="champ-name">${esc(name)}</span>
          <span class="champ-games">${d.games} game${d.games > 1 ? 's' : ''}</span>
        </div>
        <div class="champ-metrics">
          <span class="champ-wr ${wrCls}">${d.winrate}% WR</span>
          <span class="champ-kda">${d.avgKDA} KDA</span>
        </div>
      </div>
    `);
  }

  // Mastery-only champions not in recent games
  const existingNames = champEntries.map(([n]) => n);
  if (analytics.topChampions && analytics.topChampions.length > 0) {
    for (const m of analytics.topChampions) {
      if (m.championName && !existingNames.includes(m.championName)) {
        let iconUrl = '';
        try { iconUrl = await getChampionIconUrl(m.championName); } catch { /* fallback */ }
        parts.push(`
          <div class="champ-card-ext champ-mastery-only">
            <img class="champ-icon" src="${iconUrl}" alt="${esc(m.championName)}" onerror="this.style.display='none'" />
            <div class="champ-info">
              <span class="champ-name">${esc(m.championName)}</span>
              <span class="champ-games">Mastery ${m.masteryLevel}</span>
            </div>
            <div class="champ-metrics">
              <span class="champ-mastery-pts">${formatMasteryPoints(m.masteryPoints)} pts</span>
            </div>
          </div>
        `);
      }
    }
  }

  champPool.innerHTML = parts.join('');

  // Click handlers for champion detail
  champPool.querySelectorAll('.champ-card-ext:not(.champ-mastery-only)').forEach(card => {
    const nameEl = card.querySelector('.champ-name');
    if (nameEl) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        openChampionModal(nameEl.textContent, analytics);
      });
    }
  });
}

async function renderChampionSynergies(synergies) {
  const container = document.getElementById('champion-synergies');
  if (!synergies || synergies.length === 0) {
    container.innerHTML = '<p class="empty-note">Aucune synergie trouvee</p>';
    return;
  }

  const parts = [];
  for (const syn of synergies) {
    let iconUrl = '';
    try { iconUrl = await getChampionIconUrl(syn.champion); } catch { /* fallback */ }
    parts.push(`
      <div class="synergy-card">
        <img class="synergy-icon" src="${iconUrl}" alt="${esc(syn.champion)}" onerror="this.style.display='none'" />
        <div class="synergy-info">
          <span class="synergy-name">${esc(syn.champion)}</span>
          <span class="synergy-with">Synergie avec : ${syn.matchedWith.map(n => esc(n)).join(', ')}</span>
        </div>
        <span class="synergy-score">${syn.score} match${syn.score > 1 ? 's' : ''}</span>
      </div>
    `);
  }

  container.innerHTML = `<div class="synergy-list">${parts.join('')}</div>`;
}

function renderDamageComposition(dmg) {
  const container = document.getElementById('damage-composition');
  if (!dmg) {
    container.innerHTML = '<p class="empty-note">Aucune donnee</p>';
    return;
  }

  container.innerHTML = `
    <div class="dmg-comp">
      <div class="dmg-bar-combined">
        <div class="dmg-bar-segment dmg-physical" style="width:${dmg.physical}%" title="Physique ${dmg.physical}%"></div>
        <div class="dmg-bar-segment dmg-magic" style="width:${dmg.magic}%" title="Magique ${dmg.magic}%"></div>
        <div class="dmg-bar-segment dmg-true" style="width:${dmg.true}%" title="Brut ${dmg.true}%"></div>
      </div>
      <div class="dmg-legend">
        <span class="dmg-legend-item"><span class="dmg-dot dmg-physical"></span>Physique ${dmg.physical}%</span>
        <span class="dmg-legend-item"><span class="dmg-dot dmg-magic"></span>Magique ${dmg.magic}%</span>
        <span class="dmg-legend-item"><span class="dmg-dot dmg-true"></span>Brut ${dmg.true}%</span>
      </div>
    </div>
  `;
}

function renderRoles(byRole) {
  const rolesContainer = document.getElementById('roles-bars');
  const roleEntries = Object.entries(byRole || {}).sort((a, b) => b[1].games - a[1].games);
  const maxRoleGames = roleEntries.length > 0 ? roleEntries[0][1].games : 1;

  rolesContainer.innerHTML = roleEntries.map(([role, data]) => {
    const pct = Math.round((data.games / maxRoleGames) * 100);
    const wrCls = data.winrate >= 50 ? 'stat-good' : 'stat-bad';
    return `
      <div class="role-bar-row">
        <span class="role-bar-label">${formatRoleName(role)}</span>
        <div class="role-bar-track">
          <div class="role-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="role-bar-info">${data.games}G</span>
        <span class="role-bar-wr ${wrCls}">${data.winrate}%</span>
        <span class="role-bar-kda">${data.avgKDA} KDA</span>
      </div>
    `;
  }).join('') || '<p class="empty-note">Aucun role detecte</p>';
}

function renderEarlyGame(early) {
  const container = document.getElementById('early-game-stats');
  if (!early) {
    container.innerHTML = '<p class="empty-note">Aucune donnee</p>';
    return;
  }

  container.innerHTML = `
    <div class="early-stats">
      <div class="early-stat">
        <span class="early-stat-val">${early.avgCSAt10}</span>
        <span class="early-stat-label">CS @ 10 min</span>
        <span class="early-stat-bench">${early.avgCSAt10 >= 70 ? 'Bon' : early.avgCSAt10 >= 55 ? 'Moyen' : 'Faible'}</span>
      </div>
      <div class="early-stat">
        <span class="early-stat-val">${early.firstBloodRate}%</span>
        <span class="early-stat-label">First Blood Rate</span>
        <span class="early-stat-bench">${early.firstBloodRate >= 30 ? 'Agressif' : 'Passif'}</span>
      </div>
      <div class="early-stat">
        <span class="early-stat-val">${early.avgTurretPlates}</span>
        <span class="early-stat-label">Turret Plates / game</span>
        <span class="early-stat-bench">${early.avgTurretPlates >= 1.5 ? 'Bon' : 'Peut mieux faire'}</span>
      </div>
      <div class="early-stat">
        <span class="early-stat-val">${early.avgSoloKills}</span>
        <span class="early-stat-label">Solo Kills / game</span>
        <span class="early-stat-bench">${early.avgSoloKills >= 1 ? 'Dominant' : 'Safe'}</span>
      </div>
    </div>
  `;
}

function renderTrends(t) {
  const trendsRow = document.getElementById('trends-row');
  if (!t) {
    trendsRow.innerHTML = '<p class="empty-note">Pas de tendances</p>';
    return;
  }

  const wrArrow = t.recentWinrate > t.previousWinrate ? '&#9650;' : t.recentWinrate < t.previousWinrate ? '&#9660;' : '&#9644;';
  const wrClass = t.recentWinrate >= t.previousWinrate ? 'trend-up' : 'trend-down';

  const kdaIcon = t.kdaTrend === 'improving' ? '&#9650;' : t.kdaTrend === 'declining' ? '&#9660;' : '&#9644;';
  const kdaCls = t.kdaTrend === 'improving' ? 'trend-up' : t.kdaTrend === 'declining' ? 'trend-down' : 'trend-stable';

  const csIcon = t.csTrend === 'improving' ? '&#9650;' : t.csTrend === 'declining' ? '&#9660;' : '&#9644;';
  const csCls = t.csTrend === 'improving' ? 'trend-up' : t.csTrend === 'declining' ? 'trend-down' : 'trend-stable';

  trendsRow.innerHTML = `
    <div class="trend-card">
      <span class="trend-icon ${wrClass}">${wrArrow}</span>
      <div>
        <span class="trend-label">Winrate recente</span>
        <span class="trend-value">${t.recentWinrate}% <span class="trend-sub">vs ${t.previousWinrate}%</span></span>
      </div>
    </div>
    <div class="trend-card">
      <span class="trend-icon ${kdaCls}">${kdaIcon}</span>
      <div>
        <span class="trend-label">KDA</span>
        <span class="trend-value trend-capitalize">${t.kdaTrend === 'improving' ? 'En progres' : t.kdaTrend === 'declining' ? 'En baisse' : 'Stable'}</span>
      </div>
    </div>
    <div class="trend-card">
      <span class="trend-icon ${csCls}">${csIcon}</span>
      <div>
        <span class="trend-label">CS/min</span>
        <span class="trend-value">${t.recentCS} <span class="trend-sub">vs ${t.prevCS}</span></span>
      </div>
    </div>
  `;
}

// ===== LP PROGRESSION CHART =====

async function renderLPChart(analytics, profile) {
  const container = document.getElementById('lp-chart-container');
  const ranked = (analytics.matchHistory || []).filter(m => m.win !== undefined);

  if (ranked.length < 2) {
    container.innerHTML = '<p class="empty-note">Pas assez de donnees pour le graphique</p>';
    return;
  }

  const points = estimateLPProgression(ranked, profile.rank_tier, profile.rank_division, profile.lp || 0);
  if (points.length < 2) {
    container.innerHTML = '<p class="empty-note">Pas assez de donnees</p>';
    return;
  }

  // Enrich points with match data (chronological: oldest → newest)
  // points[0] = estimated LP before all games
  // points[j>=1] = after match ranked[ranked.length - j]
  const enriched = points.map((p, j) => {
    if (j === 0) return { ...p, match: null };
    const matchIdx = ranked.length - j;
    return { ...p, match: ranked[matchIdx] || null };
  });

  // Pre-fetch champion icons
  const uniqueChamps = [...new Set(ranked.map(m => m.champion).filter(Boolean))];
  const champIcons = {};
  await Promise.all(uniqueChamps.map(async (name) => {
    try { champIcons[name] = await getChampionIconUrl(name); } catch { champIcons[name] = ''; }
  }));

  // --- LP by champion ---
  const lpByChampRaw = {};
  for (const m of ranked) {
    if (!lpByChampRaw[m.champion]) lpByChampRaw[m.champion] = { wins: 0, losses: 0, lpNet: 0 };
    if (m.win) { lpByChampRaw[m.champion].wins++; lpByChampRaw[m.champion].lpNet += 22; }
    else { lpByChampRaw[m.champion].losses++; lpByChampRaw[m.champion].lpNet -= 18; }
  }
  const champLPList = Object.entries(lpByChampRaw)
    .map(([name, d]) => ({ name, ...d, games: d.wins + d.losses, icon: champIcons[name] || '' }))
    .sort((a, b) => b.lpNet - a.lpNet);

  // --- Summary stats ---
  const totalLPChange = enriched[enriched.length - 1].lp - enriched[0].lp;
  const wins = ranked.filter(m => m.win).length;
  const losses = ranked.length - wins;

  const reversed = [...ranked].reverse(); // oldest first
  let maxWinStreak = 0, maxLossStreak = 0, wStreak = 0, lStreak = 0;
  for (const m of reversed) {
    if (m.win) { wStreak++; lStreak = 0; maxWinStreak = Math.max(maxWinStreak, wStreak); }
    else { lStreak++; wStreak = 0; maxLossStreak = Math.max(maxLossStreak, lStreak); }
  }
  let currentStreak = 0;
  const currentStreakWin = ranked[0]?.win ?? false;
  for (const m of ranked) {
    if (m.win === currentStreakWin) currentStreak++;
    else break;
  }
  const avgLPPerGame = ranked.length > 0 ? Math.round(totalLPChange / ranked.length) : 0;

  // =================== SVG CHART ===================
  const svgW = 900;
  const svgH = 380;
  const padL = 80;
  const padR = 25;
  const padT = 20;
  const padB = 65;
  const chartW = svgW - padL - padR;
  const chartH = svgH - padT - padB;

  const lpValues = enriched.map(p => p.lp);
  const minLP = Math.min(...lpValues);
  const maxLP = Math.max(...lpValues);
  const lpRange = maxLP - minLP || 100;
  const lpPad = Math.max(lpRange * 0.15, 30);
  const yMin = Math.max(0, minLP - lpPad);
  const yMax = maxLP + lpPad;
  const yRange = yMax - yMin;

  const n = enriched.length - 1;
  const xScale = (i) => padL + (i / n) * chartW;
  const yScale = (lp) => padT + chartH - ((lp - yMin) / yRange) * chartH;

  // Smooth bezier path
  const pathPts = enriched.map((p, i) => ({ x: xScale(i), y: yScale(p.lp) }));
  let pathD = `M ${pathPts[0].x.toFixed(1)} ${pathPts[0].y.toFixed(1)}`;
  for (let i = 1; i < pathPts.length; i++) {
    const prev = pathPts[i - 1];
    const curr = pathPts[i];
    const cpx = (prev.x + curr.x) / 2;
    pathD += ` C ${cpx.toFixed(1)} ${prev.y.toFixed(1)}, ${cpx.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
  }

  // Area fill
  const areaD = pathD +
    ` L ${pathPts[pathPts.length - 1].x.toFixed(1)} ${(padT + chartH).toFixed(1)}` +
    ` L ${pathPts[0].x.toFixed(1)} ${(padT + chartH).toFixed(1)} Z`;

  // Y-axis ticks & grid
  const yTickCount = 5;
  const yLabels = [];
  for (let i = 0; i <= yTickCount; i++) {
    const lp = yMin + (yRange / yTickCount) * i;
    yLabels.push({ lp: Math.round(lp), y: yScale(lp) });
  }
  const gridLines = yLabels.map(l =>
    `<line x1="${padL}" y1="${l.y.toFixed(1)}" x2="${svgW - padR}" y2="${l.y.toFixed(1)}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>`
  ).join('');
  const yLabelsSvg = yLabels.map(l =>
    `<text x="${padL - 12}" y="${(l.y + 4).toFixed(1)}" text-anchor="end" fill="var(--text-muted)" font-size="10" font-family="var(--font)">${lpToRankLabel(l.lp)}</text>`
  ).join('');

  // Starting LP reference line
  const startY = yScale(enriched[0].lp);
  const startLine = `<line x1="${padL}" y1="${startY.toFixed(1)}" x2="${svgW - padR}" y2="${startY.toFixed(1)}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="4 4" opacity="0.25"/>`;

  // Dots (visible + hit areas)
  const dots = enriched.map((p, i) => {
    const x = xScale(i).toFixed(1);
    const y = yScale(p.lp).toFixed(1);
    const isLast = i === enriched.length - 1;
    const isFirst = i === 0;
    const match = p.match;
    let color = 'var(--text-muted)';
    let r = 5;
    if (isLast) { color = 'var(--gold)'; r = 7; }
    else if (!isFirst && match) { color = match.win ? 'var(--success)' : 'var(--error)'; }

    const ring = isLast
      ? `<circle cx="${x}" cy="${y}" r="11" fill="none" stroke="var(--gold)" stroke-width="2" opacity="0.3"/>`
      : '';
    const hitArea = `<circle cx="${x}" cy="${y}" r="16" fill="transparent" class="lp-dot-hit" data-index="${i}" style="cursor:pointer"/>`;

    return `${ring}<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="var(--bg-card-solid)" stroke-width="2" class="lp-dot" data-index="${i}"/>${hitArea}`;
  }).join('');

  // Champion icons below x-axis
  const iconSize = 20;
  const iconY = padT + chartH + 10;
  const clipDefs = [];
  const champIconsSvg = [];

  for (let i = 0; i < enriched.length; i++) {
    const p = enriched[i];
    if (!p.match) continue;
    const x = xScale(i);
    const iconUrl = champIcons[p.match.champion] || '';
    if (!iconUrl) continue;
    const cy = iconY + iconSize / 2;
    const r = iconSize / 2;
    const winColor = p.match.win ? 'var(--success)' : 'var(--error)';

    clipDefs.push(`<clipPath id="lpc-${i}"><circle cx="${x.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"/></clipPath>`);
    champIconsSvg.push(`
      <image x="${(x - r).toFixed(1)}" y="${iconY.toFixed(1)}" width="${iconSize}" height="${iconSize}" href="${iconUrl}" clip-path="url(#lpc-${i})" preserveAspectRatio="xMidYMid slice"/>
      <circle cx="${x.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${winColor}" stroke-width="1.5"/>
    `);
  }

  // Win/loss strip below champion icons
  const stripY = iconY + iconSize + 5;
  const stripParts = enriched.map((p, i) => {
    if (!p.match) return '';
    const x = xScale(i);
    const color = p.match.win ? 'var(--success)' : 'var(--error)';
    return `<rect x="${(x - 3).toFixed(1)}" y="${stripY}" width="6" height="4" rx="2" fill="${color}" opacity="0.5"/>`;
  }).join('');

  // X-axis labels
  const xAxisLabels = `
    <text x="${xScale(0).toFixed(1)}" y="${(svgH - 2).toFixed(1)}" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="var(--font)">-${n} games</text>
    <text x="${xScale(n).toFixed(1)}" y="${(svgH - 2).toFixed(1)}" text-anchor="middle" fill="var(--gold)" font-size="10" font-family="var(--font)" font-weight="700">Actuel</text>
  `;

  // Hover line (positioned via JS)
  const hoverLine = `<line id="lp-hover-line" x1="0" y1="${padT}" x2="0" y2="${padT + chartH}" stroke="var(--gold)" stroke-width="1" opacity="0" stroke-dasharray="3 3"/>`;

  const svg = `
    <svg viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="xMidYMid meet" width="100%">
      <defs>
        <linearGradient id="lp-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--gold)" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="var(--gold)" stop-opacity="0.01"/>
        </linearGradient>
        ${clipDefs.join('\n')}
      </defs>
      ${gridLines}
      ${yLabelsSvg}
      ${startLine}
      <path d="${areaD}" fill="url(#lp-area-grad)"/>
      <path d="${pathD}" fill="none" stroke="var(--gold)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${hoverLine}
      ${dots}
      ${champIconsSvg.join('')}
      ${stripParts}
      ${xAxisLabels}
    </svg>
  `;

  // =================== SUMMARY BAR ===================
  const lpChangeSign = totalLPChange >= 0 ? '+' : '';
  const lpChangeCls = totalLPChange >= 0 ? 'lp-positive' : 'lp-negative';
  const avgSign = avgLPPerGame >= 0 ? '+' : '';
  const streakLabel = currentStreakWin ? `${currentStreak}W` : `${currentStreak}L`;
  const streakCls = currentStreakWin ? 'lp-positive' : 'lp-negative';

  const summaryHtml = `
    <div class="lp-summary-bar">
      <div class="lp-summary-item">
        <span class="lp-summary-val ${lpChangeCls}">${lpChangeSign}${totalLPChange} LP</span>
        <span class="lp-summary-label">Bilan net</span>
      </div>
      <div class="lp-summary-item">
        <span class="lp-summary-val">${wins}W ${losses}L</span>
        <span class="lp-summary-label">Record</span>
      </div>
      <div class="lp-summary-item">
        <span class="lp-summary-val ${streakCls}">${streakLabel}</span>
        <span class="lp-summary-label">Serie en cours</span>
      </div>
      <div class="lp-summary-item">
        <span class="lp-summary-val">${maxWinStreak}W</span>
        <span class="lp-summary-label">Meilleure serie</span>
      </div>
      <div class="lp-summary-item">
        <span class="lp-summary-val ${avgLPPerGame >= 0 ? 'lp-positive' : 'lp-negative'}">${avgSign}${avgLPPerGame}/g</span>
        <span class="lp-summary-label">LP moyen</span>
      </div>
    </div>
  `;

  // =================== LP BY CHAMPION ===================
  const maxAbsLP = Math.max(...champLPList.map(c => Math.abs(c.lpNet)), 1);
  const champRows = champLPList.map(c => {
    const pct = Math.round((Math.abs(c.lpNet) / maxAbsLP) * 100);
    const isPos = c.lpNet >= 0;
    const barCls = isPos ? 'lp-bar-pos' : 'lp-bar-neg';
    const sign = isPos ? '+' : '';
    const netCls = isPos ? 'lp-positive' : 'lp-negative';
    const avgLP = c.games > 0 ? Math.round(c.lpNet / c.games) : 0;
    const avgLPSign = avgLP >= 0 ? '+' : '';
    const avgCls = avgLP >= 0 ? 'lp-positive' : 'lp-negative';
    const wr = c.games > 0 ? Math.round((c.wins / c.games) * 100) : 0;
    const wrCls = wr >= 55 ? 'lp-positive' : wr < 45 ? 'lp-negative' : '';

    return `
      <div class="lp-champ-row">
        <img class="lp-champ-icon" src="${c.icon}" alt="${esc(c.name)}" onerror="this.style.display='none'" />
        <div class="lp-champ-info">
          <span class="lp-champ-name">${esc(c.name)}</span>
          <span class="lp-champ-record">${c.wins}W ${c.losses}L <span class="${wrCls}">(${wr}%)</span></span>
        </div>
        <div class="lp-champ-bar-wrap">
          <div class="lp-champ-bar ${barCls}" style="width: ${pct}%"></div>
        </div>
        <span class="lp-champ-net ${netCls}">${sign}${c.lpNet}</span>
        <span class="lp-champ-avg ${avgCls}">${avgLPSign}${avgLP}/g</span>
      </div>
    `;
  }).join('');

  const champHtml = champLPList.length > 0 ? `
    <div class="lp-section-header"><h4>LP par Champion</h4></div>
    <div class="lp-by-champion">${champRows}</div>
  ` : '';

  // =================== TOOLTIP ===================
  const tooltipHtml = `
    <div class="lp-tooltip hidden" id="lp-tooltip">
      <div class="lp-tooltip-inner">
        <img class="lp-tooltip-champ" id="lp-tooltip-champ" src="" alt="" />
        <div class="lp-tooltip-content">
          <span class="lp-tooltip-result" id="lp-tooltip-result"></span>
          <span class="lp-tooltip-lp" id="lp-tooltip-lp"></span>
          <span class="lp-tooltip-rank" id="lp-tooltip-rank"></span>
          <span class="lp-tooltip-kda" id="lp-tooltip-kda"></span>
        </div>
      </div>
    </div>
  `;

  // =================== RENDER ===================
  container.innerHTML = `
    <div class="lp-chart-wrapper">
      <div class="lp-chart">
        ${svg}
        ${tooltipHtml}
      </div>
      ${summaryHtml}
      ${champHtml}
    </div>
  `;

  // =================== HOVER EVENTS ===================
  const chartEl = container.querySelector('.lp-chart');
  const tooltipEl = container.querySelector('#lp-tooltip');
  const hoverLineEl = container.querySelector('#lp-hover-line');
  const tooltipChamp = container.querySelector('#lp-tooltip-champ');
  const tooltipResult = container.querySelector('#lp-tooltip-result');
  const tooltipLP = container.querySelector('#lp-tooltip-lp');
  const tooltipRank = container.querySelector('#lp-tooltip-rank');
  const tooltipKDA = container.querySelector('#lp-tooltip-kda');

  container.querySelectorAll('.lp-dot-hit').forEach(hit => {
    const idx = parseInt(hit.dataset.index);
    const p = enriched[idx];

    hit.addEventListener('mouseenter', () => {
      const svgEl = chartEl.querySelector('svg');
      const rect = svgEl.getBoundingClientRect();
      const x = xScale(idx);
      const y = yScale(p.lp);
      const relX = (x / svgW) * rect.width;
      const relY = (y / svgH) * rect.height;

      // Hover line
      hoverLineEl.setAttribute('x1', x.toFixed(1));
      hoverLineEl.setAttribute('x2', x.toFixed(1));
      hoverLineEl.setAttribute('opacity', '0.4');

      // Tooltip content
      if (p.match) {
        const m = p.match;
        tooltipChamp.src = champIcons[m.champion] || '';
        tooltipChamp.style.display = champIcons[m.champion] ? 'block' : 'none';
        tooltipResult.textContent = m.win ? 'Victoire' : 'Defaite';
        tooltipResult.className = `lp-tooltip-result ${m.win ? 'lp-positive' : 'lp-negative'}`;
        tooltipLP.textContent = `${m.win ? '+22' : '-18'} LP`;
        tooltipLP.className = `lp-tooltip-lp ${m.win ? 'lp-positive' : 'lp-negative'}`;
        tooltipKDA.textContent = `${m.kills}/${m.deaths}/${m.assists} · ${m.champion}`;
      } else {
        tooltipChamp.style.display = 'none';
        tooltipResult.textContent = 'Depart';
        tooltipResult.className = 'lp-tooltip-result';
        tooltipLP.textContent = '';
        tooltipKDA.textContent = '';
      }
      tooltipRank.textContent = lpToRankLabel(p.lp);

      // Position
      const tw = 190;
      let left = relX - tw / 2;
      if (left < 0) left = 4;
      if (left + tw > rect.width) left = rect.width - tw - 4;
      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top = `${Math.max(0, relY - 95)}px`;
      tooltipEl.classList.remove('hidden');
    });

    hit.addEventListener('mouseleave', () => {
      tooltipEl.classList.add('hidden');
      hoverLineEl.setAttribute('opacity', '0');
    });
  });
}

// ===== CHAMPION DETAIL MODAL =====

async function openChampionModal(champName, analytics) {
  const champData = analytics.byChampion[champName];
  if (!champData) return;

  const modal = document.getElementById('modal-champion');
  const content = document.getElementById('champion-detail-content');

  content.innerHTML = '<div class="mh-loading">Chargement...</div>';
  modal.classList.remove('hidden');

  await renderChampionDetail(champName, champData, content);
}

async function renderChampionDetail(champName, d, container) {
  let iconUrl = '';
  try { iconUrl = await getChampionIconUrl(champName); } catch { /* fallback */ }

  // Top items with icons
  const itemParts = [];
  for (const item of (d.topItems || [])) {
    let url = '';
    try { url = await getItemIconUrl(item.id); } catch { /* fallback */ }
    itemParts.push(`<div class="cd-item-wrap" title="Utilise dans ${item.count} game${item.count > 1 ? 's' : ''}">
      <img class="cd-item-icon detail-clickable" data-detail-type="item" data-detail-id="${item.id}" src="${url}" alt="" onerror="this.style.display='none'" />
      <span class="cd-item-count">${item.count}x</span>
    </div>`);
  }

  const wrCls = d.winrate >= 55 ? 'cd-wr-good' : d.winrate < 45 ? 'cd-wr-bad' : '';

  // Damage composition
  const dc = d.damageComp || {};
  const dmgBar = `
    <div class="dmg-bar-combined" style="margin-bottom:0.5rem">
      <div class="dmg-bar-segment dmg-physical" style="width:${dc.physical || 0}%"></div>
      <div class="dmg-bar-segment dmg-magic" style="width:${dc.magic || 0}%"></div>
      <div class="dmg-bar-segment dmg-true" style="width:${dc.true || 0}%"></div>
    </div>
    <div class="dmg-legend" style="font-size:0.72rem">
      <span class="dmg-legend-item"><span class="dmg-dot dmg-physical"></span>Physique ${dc.physical || 0}%</span>
      <span class="dmg-legend-item"><span class="dmg-dot dmg-magic"></span>Magique ${dc.magic || 0}%</span>
      <span class="dmg-legend-item"><span class="dmg-dot dmg-true"></span>Brut ${dc.true || 0}%</span>
    </div>
  `;

  container.innerHTML = `
    <div class="cd-header">
      <img class="cd-icon" src="${iconUrl}" alt="${esc(champName)}" onerror="this.style.display='none'" />
      <div class="cd-header-info">
        <h2 class="cd-name">${esc(champName)}</h2>
        <span class="cd-sub">${d.games} game${d.games > 1 ? 's' : ''} &middot; <span class="${wrCls}">${d.winrate}% WR</span> &middot; ${formatRoleName(d.mainRole)}</span>
      </div>
    </div>

    <div class="cd-stats-grid">
      <div class="cd-stat">
        <span class="cd-stat-val">${d.avgKDA}</span>
        <span class="cd-stat-label">KDA</span>
        <span class="cd-stat-sub">${d.avgKills}/${d.avgDeaths}/${d.avgAssists}</span>
      </div>
      <div class="cd-stat">
        <span class="cd-stat-val">${d.avgCSPerMin}</span>
        <span class="cd-stat-label">CS/min</span>
      </div>
      <div class="cd-stat">
        <span class="cd-stat-val">${d.avgDamagePerMin}</span>
        <span class="cd-stat-label">DMG/min</span>
      </div>
      <div class="cd-stat">
        <span class="cd-stat-val">${d.avgGoldPerMin}</span>
        <span class="cd-stat-label">Gold/min</span>
      </div>
      <div class="cd-stat">
        <span class="cd-stat-val">${d.avgVisionPerMin}</span>
        <span class="cd-stat-label">Vision/min</span>
      </div>
      <div class="cd-stat">
        <span class="cd-stat-val">${d.avgKP}%</span>
        <span class="cd-stat-label">KP</span>
      </div>
    </div>

    <div class="cd-section">
      <h4>Composition des degats</h4>
      ${dmgBar}
    </div>

    <div class="cd-section">
      <h4>Playstyle</h4>
      <div class="cd-playstyle-row">
        <div class="cd-ps-item">
          <span class="cd-ps-val">${d.avgSoloKills}</span>
          <span class="cd-ps-label">Solo Kills/game</span>
        </div>
        <div class="cd-ps-item">
          <span class="cd-ps-val">${d.firstBloodRate}%</span>
          <span class="cd-ps-label">First Blood</span>
        </div>
        <div class="cd-ps-item">
          <span class="cd-ps-val">${d.avgControlWards}</span>
          <span class="cd-ps-label">Control Wards/game</span>
        </div>
      </div>
    </div>

    ${itemParts.length > 0 ? `
    <div class="cd-section">
      <h4>Items les plus joues</h4>
      <div class="cd-items-row">${itemParts.join('')}</div>
    </div>
    ` : ''}

    <div class="cd-section">
      <h4>Historique sur ce champion</h4>
      <div class="cd-match-cards"></div>
    </div>
  `;

  // Populate full match cards from loaded history, filtered by champion
  const matchContainer = container.querySelector('.cd-match-cards');
  const champMatches = mhMatches.filter(m => m.championName === champName);

  if (champMatches.length === 0) {
    matchContainer.innerHTML = '<p class="empty-note">Aucune partie sur ce champion dans l\'historique charge</p>';
  } else {
    await renderMatchCards(champMatches, matchContainer);
  }
}

// ===== MATCH HISTORY (OP.GG STYLE) =====

function initMatchHistory(puuid) {
  mhPuuid = puuid;
  mhMatches = [];
  mhStart = 0;
  document.getElementById('match-history-list').innerHTML = '';
  // Reset tab to "Tout"
  document.querySelectorAll('.mh-queue-tab').forEach(t => t.classList.remove('active'));
  const allTab = document.querySelector('.mh-queue-tab[data-queue=""]');
  if (allTab) allTab.classList.add('active');
  mhQueueFilter = '';
  loadMatchHistoryPage();
}

async function loadMatchHistoryPage() {
  if (mhLoading || !mhPuuid) return;
  mhLoading = true;

  const loadingEl = document.getElementById('match-history-loading');
  const loadMoreBtn = document.getElementById('btn-load-more-matches');
  loadingEl.classList.remove('hidden');
  loadMoreBtn.disabled = true;

  try {
    const newMatches = await fetchMatchHistoryPage(mhPuuid, mhStart, 10, mhQueueFilter);
    mhMatches.push(...newMatches);
    mhStart += 10;

    await renderMatchCards(newMatches);

    // Hide load more if no results
    if (newMatches.length < 10) {
      loadMoreBtn.classList.add('hidden');
    } else {
      loadMoreBtn.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Match history error:', err);
    const list = document.getElementById('match-history-list');
    if (mhMatches.length === 0) {
      list.innerHTML = '<p class="empty-note">Impossible de charger l\'historique</p>';
    }
  } finally {
    mhLoading = false;
    loadingEl.classList.add('hidden');
    loadMoreBtn.disabled = false;
  }
}

async function renderMatchCards(matches, targetContainer) {
  const list = targetContainer || document.getElementById('match-history-list');
  for (const m of matches) {
    const card = await buildMatchCard(m);
    list.appendChild(card);
  }
}

async function buildMatchCard(m) {
  const card = document.createElement('div');
  card.className = `mh-card ${m.win ? 'mh-card-win' : 'mh-card-loss'}`;

  // Pre-fetch icons
  const [champIcon, spell1Icon, spell2Icon, keystoneIcon, secondaryIcon] = await Promise.all([
    getChampionIconUrl(m.championName).catch(() => ''),
    getSummonerSpellIconUrl(m.summoner1Id).catch(() => ''),
    getSummonerSpellIconUrl(m.summoner2Id).catch(() => ''),
    getRuneIconUrl(m.primaryRuneId).catch(() => ''),
    getRuneIconUrl(m.secondaryTreeId).catch(() => ''),
  ]);

  const itemsHtml = await buildItemsHtml(m.items);
  const team1 = m.participants.filter(p => p.teamId === 100);
  const team2 = m.participants.filter(p => p.teamId === 200);
  const teamsHtml = await buildTeamsHtml(team1, team2, m.playerTeamId);

  const timeAgo = formatTimeAgo(m.gameCreation);
  const queueName = getQueueName(m.queueId);

  const kdaNum = parseFloat(m.kdaRatio);
  const kdaCls = m.kdaRatio === 'Perfect' ? 'kda-perfect' : kdaNum >= 4 ? 'kda-great' : kdaNum >= 3 ? 'kda-good' : kdaNum >= 2 ? 'kda-avg' : 'kda-bad';

  card.innerHTML = `
    <div class="mh-card-type">
      <span class="mh-card-queue">${esc(queueName)}</span>
      <span class="mh-card-ago">${timeAgo}</span>
      <span class="mh-card-toggle">&#9660;</span>
    </div>
    <div class="mh-card-result">
      <span class="mh-card-wl">${m.win ? 'Victoire' : 'Defaite'}</span>
      <span class="mh-card-dur">${m.gameDuration}</span>
    </div>
    <div class="mh-card-body">
      <div class="mh-card-champ">
        <div class="mh-card-champ-main">
          <div class="mh-card-champ-icon-wrap">
            <img class="mh-card-champ-img" src="${champIcon}" alt="${esc(m.championName)}" onerror="this.style.display='none'" />
            <span class="mh-card-champ-level">${m.champLevel}</span>
          </div>
          <div class="mh-card-spells">
            <img class="mh-spell-icon detail-clickable" data-detail-type="spell" data-detail-id="${m.summoner1Id}" src="${spell1Icon}" alt="" onerror="this.style.display='none'" />
            <img class="mh-spell-icon detail-clickable" data-detail-type="spell" data-detail-id="${m.summoner2Id}" src="${spell2Icon}" alt="" onerror="this.style.display='none'" />
          </div>
          <div class="mh-card-runes">
            <img class="mh-rune-icon mh-rune-primary detail-clickable" data-detail-type="rune" data-detail-id="${m.primaryRuneId}" src="${keystoneIcon}" alt="" onerror="this.style.display='none'" />
            <img class="mh-rune-icon mh-rune-secondary detail-clickable" data-detail-type="rune" data-detail-id="${m.secondaryTreeId}" src="${secondaryIcon}" alt="" onerror="this.style.display='none'" />
          </div>
        </div>
      </div>
      <div class="mh-card-stats">
        <div class="mh-card-kda">
          <span class="mh-card-kda-nums">${m.kills} / <span class="mh-card-deaths">${m.deaths}</span> / ${m.assists}</span>
          <span class="mh-card-kda-ratio ${kdaCls}">${m.kdaRatio}${m.kdaRatio !== 'Perfect' ? ':1' : ''} KDA</span>
        </div>
        <div class="mh-card-detail-stats">
          <span>CS ${m.csTotal} (${m.csPerMin}/m)</span>
          <span>Vision ${m.visionScore}</span>
          <span>KP ${m.killParticipation}%</span>
        </div>
      </div>
      <div class="mh-card-items">
        ${itemsHtml}
      </div>
      <div class="mh-card-teams">
        ${teamsHtml}
      </div>
    </div>
    <div class="mh-card-expand hidden"></div>
  `;

  // Click to toggle expansion
  card.style.cursor = 'pointer';
  card.addEventListener('click', async (e) => {
    // Don't toggle if clicking a link or button
    if (e.target.closest('a, button, .detail-clickable')) return;
    const expandDiv = card.querySelector('.mh-card-expand');
    if (card.classList.contains('mh-card-expanded')) {
      card.classList.remove('mh-card-expanded');
      expandDiv.classList.add('hidden');
    } else {
      card.classList.add('mh-card-expanded');
      expandDiv.classList.remove('hidden');
      if (!expandDiv.dataset.loaded) {
        expandDiv.dataset.loaded = '1';
        expandDiv.innerHTML = '<div class="mh-loading">Chargement des details...</div>';
        await populateExpansion(expandDiv, m);
      }
    }
  });

  return card;
}

async function populateExpansion(container, match) {
  const team1 = match.participants.filter(p => p.teamId === 100);
  const team2 = match.participants.filter(p => p.teamId === 200);
  const teamData1 = (match.teams || []).find(t => t.teamId === 100);
  const teamData2 = (match.teams || []).find(t => t.teamId === 200);

  const buildPlayerRow = async (p) => {
    let champIcon = '';
    try { champIcon = await getChampionIconUrl(p.championName); } catch { /* */ }
    const pItems = await buildParticipantItems(p.items || []);
    const deaths = p.deaths || 0;
    const kda = `${p.kills}/${deaths}/${p.assists}`;
    const dmg = formatDmg(p.totalDamageDealtToChampions || 0);
    const opggName = p.tagLine
      ? `${encodeURIComponent(p.summonerName)}-${encodeURIComponent(p.tagLine)}`
      : encodeURIComponent(p.summonerName);
    const opggUrl = `https://www.op.gg/summoners/euw/${opggName}`;
    return `
      <div class="mh-exp-player">
        <img class="mh-exp-champ-icon" src="${champIcon}" alt="${esc(p.championName)}" onerror="this.style.display='none'" />
        <a class="mh-exp-name mh-player-link" href="${opggUrl}" data-riot-name="${esc(p.summonerName)}" data-riot-tag="${esc(p.tagLine)}" data-puuid="${esc(p.puuid || '')}" target="_blank" rel="noopener" title="${esc(p.summonerName)}${p.tagLine ? '#' + esc(p.tagLine) : ''}">${esc(p.summonerName)}</a>
        <span class="mh-exp-kda">${kda}</span>
        <span class="mh-exp-dmg">${dmg}</span>
        <span class="mh-exp-cs">${p.cs || 0}</span>
        <span class="mh-exp-ward">${p.visionScore || 0}</span>
        <div class="mh-exp-items">${pItems}</div>
      </div>
    `;
  };

  const rows1 = [];
  for (const p of team1) rows1.push(await buildPlayerRow(p));
  const rows2 = [];
  for (const p of team2) rows2.push(await buildPlayerRow(p));

  const objHtml = (td) => {
    if (!td) return '';
    return `
      <span class="mh-exp-obj" title="Tours">&#127984; ${td.towerKills}</span>
      <span class="mh-exp-obj" title="Dragons">&#128009; ${td.dragonKills}</span>
      <span class="mh-exp-obj" title="Barons">&#128081; ${td.baronKills}</span>
    `;
  };

  container.innerHTML = `
    <div class="mh-exp-header">
      <span class="mh-exp-hcol mh-exp-hcol-champ"></span>
      <span class="mh-exp-hcol mh-exp-hcol-name">Joueur</span>
      <span class="mh-exp-hcol">KDA</span>
      <span class="mh-exp-hcol">Degats</span>
      <span class="mh-exp-hcol">CS</span>
      <span class="mh-exp-hcol">Vision</span>
      <span class="mh-exp-hcol mh-exp-hcol-items">Items</span>
    </div>
    <div class="mh-exp-team">
      <div class="mh-exp-team-label ${teamData1?.win ? 'mh-exp-win' : 'mh-exp-loss'}">
        <span>${teamData1?.win ? 'Victoire' : 'Defaite'} - Equipe bleue</span>
        <span class="mh-exp-objectives">${objHtml(teamData1)}</span>
      </div>
      ${rows1.join('')}
    </div>
    <div class="mh-exp-team">
      <div class="mh-exp-team-label ${teamData2?.win ? 'mh-exp-win' : 'mh-exp-loss'}">
        <span>${teamData2?.win ? 'Victoire' : 'Defaite'} - Equipe rouge</span>
        <span class="mh-exp-objectives">${objHtml(teamData2)}</span>
      </div>
      ${rows2.join('')}
    </div>
  `;
}

async function buildParticipantItems(items) {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const itemId = items[i] || 0;
    if (itemId > 0) {
      let url = '';
      try { url = await getItemIconUrl(itemId); } catch { /* */ }
      parts.push(`<img class="mh-exp-item detail-clickable" data-detail-type="item" data-detail-id="${itemId}" src="${url}" alt="" onerror="this.classList.add('mh-item-empty')" />`);
    } else {
      parts.push(`<div class="mh-exp-item mh-item-empty"></div>`);
    }
  }
  return parts.join('');
}

function formatDmg(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

async function buildItemsHtml(items) {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const itemId = items[i] || 0;
    if (itemId > 0) {
      let url = '';
      try { url = await getItemIconUrl(itemId); } catch { /* */ }
      parts.push(`<img class="mh-item-icon${i === 6 ? ' mh-item-trinket' : ''} detail-clickable" data-detail-type="item" data-detail-id="${itemId}" src="${url}" alt="" onerror="this.classList.add('mh-item-empty')" />`);
    } else {
      parts.push(`<div class="mh-item-icon mh-item-empty${i === 6 ? ' mh-item-trinket' : ''}"></div>`);
    }
  }
  return `<div class="mh-items-grid">${parts.join('')}</div>`;
}

async function buildTeamsHtml(team1, team2, playerTeamId) {
  const buildTeam = async (team) => {
    const items = [];
    for (const p of team) {
      let icon = '';
      try { icon = await getChampionIconUrl(p.championName); } catch { /* */ }
      const opggName = p.tagLine
        ? `${encodeURIComponent(p.summonerName)}-${encodeURIComponent(p.tagLine)}`
        : encodeURIComponent(p.summonerName);
      const opggUrl = `https://www.op.gg/summoners/euw/${opggName}`;
      items.push(`
        <div class="mh-team-player" title="${esc(p.summonerName)}${p.tagLine ? '#' + esc(p.tagLine) : ''}">
          <img class="mh-team-champ-icon" src="${icon}" alt="${esc(p.championName)}" onerror="this.style.display='none'" />
          <a class="mh-team-name mh-player-link" href="${opggUrl}" data-riot-name="${esc(p.summonerName)}" data-riot-tag="${esc(p.tagLine)}" data-puuid="${esc(p.puuid || '')}" target="_blank" rel="noopener">${esc(p.summonerName)}</a>
        </div>
      `);
    }
    return items.join('');
  };

  const t1Html = await buildTeam(team1);
  const t2Html = await buildTeam(team2);
  return `
    <div class="mh-team-col">${t1Html}</div>
    <div class="mh-team-col">${t2Html}</div>
  `;
}

// ===== ANALYSIS TRIGGER =====

async function triggerAnalysis(puuid, userId) {
  if (!puuid) {
    window.showToast('PUUID introuvable. Verifie ton Riot ID d\'abord.', 'error');
    return;
  }

  const analyzeBtn = document.getElementById('btn-analyze');
  const reanalyzeBtn = document.getElementById('btn-reanalyze');
  const progressDiv = document.getElementById('analysis-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressLabel = document.getElementById('progress-label');

  analyzeBtn.disabled = true;
  reanalyzeBtn.disabled = true;
  progressDiv.classList.remove('hidden');
  progressFill.style.width = '0%';

  try {
    const onProgress = (done, total, label) => {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      progressFill.style.width = `${pct}%`;
      progressLabel.textContent = label;
    };

    const { summonerData, masteryData, matchesData } = await fetchFullPlayerData(puuid, onProgress);
    const statsList = matchesData.map(m => extractPlayerStats(m, puuid));
    let analytics = computeAnalytics(statsList, masteryData, summonerData, currentProfile?.rank_tier);
    analytics = await resolveChampionNames(analytics);

    const { error } = await supabase
      .from('profiles')
      .update({
        analytics,
        summoner_level: analytics.summonerLevel,
        profile_icon_id: analytics.profileIconId,
        last_analyzed_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) throw error;

    currentProfile.analytics = analytics;
    currentProfile.summoner_level = analytics.summonerLevel;
    currentProfile.profile_icon_id = analytics.profileIconId;
    currentProfile.last_analyzed_at = new Date().toISOString();

    window.showToast('Analyse terminee !', 'success');
    renderDashboard(currentProfile);

  } catch (err) {
    console.error('Analysis error:', err);
    window.showToast('Erreur d\'analyse: ' + err.message, 'error');
  } finally {
    analyzeBtn.disabled = false;
    reanalyzeBtn.disabled = false;
    progressDiv.classList.add('hidden');
  }
}

// ===== HELPERS =====

function statCard(value, label, cls) {
  return `
    <div class="stat-card ${cls}">
      <span class="stat-card-value">${value}</span>
      <span class="stat-card-label">${label}</span>
    </div>
  `;
}

function wrClass(wr) { return wr >= 55 ? 'stat-good' : wr >= 50 ? 'stat-neutral' : 'stat-bad'; }
function kdaClass(kda) { return kda >= 3 ? 'stat-good' : kda >= 2 ? 'stat-neutral' : 'stat-bad'; }
function csClass(cs) { return cs >= 7 ? 'stat-good' : cs >= 5 ? 'stat-neutral' : 'stat-bad'; }
function visClass(vis) { return vis >= 0.6 ? 'stat-good' : vis >= 0.4 ? 'stat-neutral' : 'stat-bad'; }
function dmgClass(dmg) { return dmg >= 25 ? 'stat-good' : dmg >= 15 ? 'stat-neutral' : 'stat-bad'; }

function formatRank(tier, division) {
  if (!tier || tier === 'UNRANKED') return 'Unranked';
  const name = tier.charAt(0) + tier.slice(1).toLowerCase();
  if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)) return name;
  return name + ' ' + (division || '');
}

function formatRoleName(role) {
  const map = { TOP: 'Top', JUNGLE: 'Jungle', MID: 'Mid', ADC: 'ADC', SUPPORT: 'Support', UNKNOWN: 'Autre' };
  return map[role] || role;
}

function formatMasteryPoints(pts) {
  if (pts >= 1000000) return (pts / 1000000).toFixed(1) + 'M';
  if (pts >= 1000) return (pts / 1000).toFixed(0) + 'k';
  return pts.toString();
}

function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 60) return `il y a ${mins}m`;
  if (hours < 24) return `il y a ${hours}h`;
  if (days < 30) return `il y a ${days}j`;
  return `il y a ${Math.floor(days / 30)} mois`;
}

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
