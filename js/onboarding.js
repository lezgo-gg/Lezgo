import { supabase } from './supabase.js';
import { verifyRiotId, getRankLabel } from './riot.js';

let currentUserId = null;
let currentDiscordInfo = null;
let verifiedData = null; // { puuid, rank, division, wins, losses, lp }
let onCompleteCallback = null;

export function initOnboarding(userId, discordInfo, onComplete) {
  currentUserId = userId;
  currentDiscordInfo = discordInfo;
  onCompleteCallback = onComplete;
  verifiedData = null;

  showStep(1);
  bindEvents();
}

function bindEvents() {
  // Step 1: Verify Riot ID
  const verifyBtn = document.getElementById('onb-verify-riot');
  if (verifyBtn && !verifyBtn.dataset.bound) {
    verifyBtn.dataset.bound = '1';
    verifyBtn.addEventListener('click', handleVerifyRiot);
  }

  const nextStep1 = document.getElementById('onb-next-1');
  if (nextStep1 && !nextStep1.dataset.bound) {
    nextStep1.dataset.bound = '1';
    nextStep1.addEventListener('click', () => showStep(2));
  }

  // Step 2: Complete profile
  const nextStep2 = document.getElementById('onb-next-2');
  if (nextStep2 && !nextStep2.dataset.bound) {
    nextStep2.dataset.bound = '1';
    nextStep2.addEventListener('click', handleSaveProfile);
  }

  // Step 3: Finish
  const finishBtn = document.getElementById('onb-finish');
  if (finishBtn && !finishBtn.dataset.bound) {
    finishBtn.dataset.bound = '1';
    finishBtn.addEventListener('click', () => {
      if (onCompleteCallback) onCompleteCallback();
    });
  }
}

function showStep(step) {
  document.querySelectorAll('.onb-step').forEach(s => s.classList.add('hidden'));
  const el = document.getElementById(`onb-step-${step}`);
  if (el) el.classList.remove('hidden');

  // Update progress indicators
  document.querySelectorAll('.onb-progress-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i < step);
    dot.classList.toggle('current', i === step - 1);
  });
}

async function handleVerifyRiot() {
  const gameName = document.getElementById('onb-riot-name').value.trim();
  const tagLine = document.getElementById('onb-riot-tag').value.trim();
  const resultDiv = document.getElementById('onb-verify-result');
  const verifyBtn = document.getElementById('onb-verify-riot');
  const nextBtn = document.getElementById('onb-next-1');

  if (!gameName || !tagLine) {
    window.showToast('Entre ton Game Name et Tag', 'error');
    return;
  }

  verifyBtn.disabled = true;
  verifyBtn.textContent = 'Verification...';
  resultDiv.classList.add('hidden');

  try {
    const data = await verifyRiotId(gameName, tagLine);
    verifiedData = { ...data, gameName, tagLine };

    const rankLabel = getRankLabel(data.rank, data.division);
    resultDiv.classList.remove('hidden', 'onb-verify-error');
    resultDiv.classList.add('onb-verify-success');
    resultDiv.innerHTML = `
      <span class="rank-${data.rank}">${rankLabel}</span>
      <span class="onb-verify-check">&#10003; Verifie</span>
      ${data.wins || data.losses ? `<span class="onb-verify-stats">${data.wins}W / ${data.losses}L</span>` : ''}
    `;

    nextBtn.disabled = false;
  } catch (err) {
    resultDiv.classList.remove('hidden', 'onb-verify-success');
    resultDiv.classList.add('onb-verify-error');
    resultDiv.textContent = err.message;
    nextBtn.disabled = true;
  } finally {
    verifyBtn.disabled = false;
    verifyBtn.textContent = 'Verifier';
  }
}

async function handleSaveProfile() {
  const roles = [...document.querySelectorAll('#onb-step-2 input[name="onb-roles"]:checked')]
    .map(cb => cb.value);
  const schedule = [...document.querySelectorAll('#onb-step-2 input[name="onb-schedule"]:checked')]
    .map(cb => cb.value);
  const style = document.querySelector('#onb-step-2 input[name="onb-play-style"]:checked')?.value;

  if (roles.length === 0) {
    window.showToast('Selectionne au moins un role', 'error');
    return;
  }
  if (schedule.length === 0) {
    window.showToast('Selectionne au moins un horaire', 'error');
    return;
  }
  if (!style) {
    window.showToast('Choisis ton style de jeu', 'error');
    return;
  }

  const saveBtn = document.getElementById('onb-next-2');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Sauvegarde...';

  try {
    const profileData = {
      id: currentUserId,
      riot_game_name: verifiedData.gameName,
      riot_tag_line: verifiedData.tagLine,
      riot_puuid: verifiedData.puuid,
      rank_tier: verifiedData.rank || 'UNRANKED',
      rank_division: verifiedData.division || null,
      roles,
      schedule,
      play_style: style,
      discord_id: currentDiscordInfo?.discord_id || null,
      discord_username: currentDiscordInfo?.discord_username || null,
      discord_avatar: currentDiscordInfo?.discord_avatar || null,
      verified: true,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('profiles')
      .upsert(profileData);

    if (error) throw error;

    // Populate Step 3 summary
    populateSummary(profileData);
    showStep(3);

    // Start auto-analysis in background
    triggerBackgroundAnalysis(verifiedData.puuid, currentUserId);

  } catch (err) {
    window.showToast('Erreur: ' + err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Suivant';
  }
}

function populateSummary(profile) {
  const avatarEl = document.getElementById('onb-summary-avatar');
  const nameEl = document.getElementById('onb-summary-name');
  const riotEl = document.getElementById('onb-summary-riot');
  const rankEl = document.getElementById('onb-summary-rank');
  const rolesEl = document.getElementById('onb-summary-roles');

  if (avatarEl && currentDiscordInfo?.discord_avatar) {
    avatarEl.src = currentDiscordInfo.discord_avatar;
  }
  if (nameEl) {
    nameEl.textContent = currentDiscordInfo?.discord_username || '';
  }
  if (riotEl) {
    riotEl.textContent = `${profile.riot_game_name}#${profile.riot_tag_line}`;
  }
  if (rankEl) {
    const label = getRankLabel(profile.rank_tier, profile.rank_division);
    rankEl.innerHTML = `<span class="rank-${profile.rank_tier}">${label}</span>`;
  }
  if (rolesEl) {
    const roleMap = { TOP: 'TOP', JUNGLE: 'JGL', MID: 'MID', ADC: 'ADC', SUPPORT: 'SUP' };
    rolesEl.textContent = (profile.roles || []).map(r => roleMap[r] || r).join(', ');
  }
}

async function triggerBackgroundAnalysis(puuid, userId) {
  const statusEl = document.getElementById('onb-analysis-status');
  if (statusEl) statusEl.textContent = 'Analyse en cours...';

  try {
    const { fetchFullPlayerData, extractPlayerStats, computeAnalytics, resolveChampionNames } = await import('./analytics.js');

    const { summonerData, masteryData, matchesData } = await fetchFullPlayerData(puuid, () => {});
    const statsList = matchesData.map(m => extractPlayerStats(m, puuid));
    let analytics = computeAnalytics(statsList, masteryData, summonerData, verifiedData?.rank);
    analytics = await resolveChampionNames(analytics);

    await supabase
      .from('profiles')
      .update({
        analytics,
        summoner_level: analytics.summonerLevel,
        profile_icon_id: analytics.profileIconId,
        last_analyzed_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (statusEl) statusEl.textContent = 'Analyse terminee !';
  } catch (err) {
    console.error('Background analysis error:', err);
    if (statusEl) statusEl.textContent = 'Analyse echouee - elle sera relancee plus tard';
  }
}
