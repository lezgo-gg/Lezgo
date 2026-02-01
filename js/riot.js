const RANK_ORDER = [
  'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM',
  'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'
];

export function getRankIndex(rank) {
  const idx = RANK_ORDER.indexOf(rank);
  return idx === -1 ? -1 : idx;
}

export function getRankLabel(tier, division) {
  if (!tier || tier === 'UNRANKED') return 'Unranked';
  if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)) {
    return tier.charAt(0) + tier.slice(1).toLowerCase();
  }
  return tier.charAt(0) + tier.slice(1).toLowerCase() + ' ' + (division || '');
}

export async function verifyRiotId(gameName, tagLine) {
  const res = await fetch('/api/verify-riot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameName, tagLine }),
  });

  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(data.error || `Erreur ${res.status}`);
  }

  return data;
}

export function initRiotVerification() {
  const btn = document.getElementById('btn-verify-riot');
  const resultDiv = document.getElementById('riot-verify-result');
  const rankDisplay = document.getElementById('rank-display');

  btn.addEventListener('click', async () => {
    const gameName = document.getElementById('riot-name').value.trim();
    const tagLine = document.getElementById('riot-tag').value.trim();

    if (!gameName || !tagLine) {
      window.showToast('Entre ton Game Name et Tag', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Vérification...';
    resultDiv.classList.add('hidden');

    try {
      const data = await verifyRiotId(gameName, tagLine);

      resultDiv.classList.remove('hidden', 'error');
      resultDiv.classList.add('success');
      resultDiv.textContent = `Compte vérifié : ${gameName}#${tagLine}`;

      resultDiv.dataset.puuid = data.puuid;

      const rankLabel = getRankLabel(data.rank, data.division);
      const statsLine = data.wins || data.losses
        ? `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.3rem">${data.wins}W / ${data.losses}L - ${data.lp} LP</div>`
        : '';
      rankDisplay.innerHTML = `
        <div class="rank-verified">
          <span class="rank-${data.rank}">${rankLabel}</span>
          <span style="color: var(--success); font-size: 0.85rem">&#10003; Vérifié</span>
        </div>
        ${statsLine}
      `;
      rankDisplay.dataset.rank = data.rank || 'UNRANKED';
      rankDisplay.dataset.division = data.division || '';

    } catch (err) {
      resultDiv.classList.remove('hidden', 'success');
      resultDiv.classList.add('error');
      resultDiv.textContent = err.message;
      rankDisplay.dataset.rank = '';
      rankDisplay.dataset.division = '';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Vérifiér';
    }
  });
}
