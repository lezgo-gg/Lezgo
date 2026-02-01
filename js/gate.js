export async function initGate(userId) {
  const grid = document.getElementById('gate-servers-grid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="gate-discord-msg">
      <p>Pour accéder à Lezgo.gg, rejoins un serveur Discord partenaire
      et clique sur le bouton dans le salon <strong>#lfg</strong>.</p>
    </div>
  `;
}
