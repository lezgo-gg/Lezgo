import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Helpers ────────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.round((Math.random() * (max - min) + min) * 100) / 100; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function futureDate(days) { return new Date(Date.now() + days * 86400000).toISOString(); }
function pastDate(days) { return new Date(Date.now() - days * 86400000).toISOString(); }

const FAKE_PUUID_PREFIX = 'fake-puuid-';

const RANKS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIVISIONS = ['IV', 'III', 'II', 'I'];
const ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
const SCHEDULES = ['MATIN', 'APRES_MIDI', 'SOIR', 'NUIT'];
const CHAMPIONS = [
  'Aatrox', 'Ahri', 'Akali', 'Alistar', 'Amumu', 'Anivia', 'Annie', 'Aphelios', 'Ashe',
  'Azir', 'Bard', 'Blitzcrank', 'Brand', 'Braum', 'Caitlyn', 'Camille', 'Cassiopeia',
  'Darius', 'Diana', 'Draven', 'Ekko', 'Elise', 'Evelynn', 'Ezreal', 'Fiora', 'Fizz',
  'Galio', 'Gangplank', 'Garen', 'Gnar', 'Graves', 'Hecarim', 'Irelia', 'Janna', 'Jarvan IV',
  'Jax', 'Jayce', 'Jhin', 'Jinx', 'Kaisa', 'Karma', 'Karthus', 'Kassadin', 'Katarina',
  'Kayn', 'Kennen', 'Khazix', 'Kindred', 'Kled', 'KogMaw', 'Leblanc', 'LeeSin', 'Leona',
  'Lissandra', 'Lucian', 'Lulu', 'Lux', 'Malphite', 'Maokai', 'MasterYi', 'MissFortune',
  'Mordekaiser', 'Morgana', 'Nami', 'Nasus', 'Nautilus', 'Nidalee', 'Nocturne', 'Olaf',
  'Orianna', 'Ornn', 'Pantheon', 'Pyke', 'Qiyana', 'Quinn', 'Rakan', 'Rammus', 'RekSai',
  'Renekton', 'Rengar', 'Riven', 'Rumble', 'Ryze', 'Samira', 'Sejuani', 'Senna', 'Seraphine',
  'Sett', 'Shen', 'Shyvana', 'Singed', 'Sion', 'Sivir', 'Sona', 'Soraka', 'Swain', 'Sylas',
  'Syndra', 'TahmKench', 'Taliyah', 'Talon', 'Taric', 'Teemo', 'Thresh', 'Tristana',
  'Trundle', 'Tryndamere', 'TwistedFate', 'Twitch', 'Udyr', 'Urgot', 'Varus', 'Vayne',
  'Veigar', 'Velkoz', 'Vi', 'Viego', 'Viktor', 'Vladimir', 'Volibear', 'Warwick', 'Wukong',
  'Xayah', 'Xerath', 'XinZhao', 'Yasuo', 'Yone', 'Yorick', 'Yuumi', 'Zac', 'Zed',
  'Zeri', 'Ziggs', 'Zilean', 'Zoe', 'Zyra',
];

// Rank multiplier for realistic stat generation
function rankMultiplier(tier) {
  const m = { IRON: 0.5, BRONZE: 0.6, SILVER: 0.7, GOLD: 0.8, PLATINUM: 0.9, EMERALD: 0.95, DIAMOND: 1.0, MASTER: 1.1, GRANDMASTER: 1.2, CHALLENGER: 1.3 };
  return m[tier] || 0.8;
}

// ─── Profile generators ─────────────────────────────────────

function generateAnalytics(tier, mainRoles) {
  const mult = rankMultiplier(tier);
  const totalGames = randInt(80, 300);
  const winrate = rand(42 + mult * 8, 48 + mult * 12);
  const avgKills = rand(3 + mult * 2, 5 + mult * 3);
  const avgDeaths = rand(6 - mult * 2, 8 - mult * 2);
  const avgAssists = rand(5 + mult * 2, 8 + mult * 3);
  const avgKDA = avgDeaths > 0 ? +((avgKills + avgAssists) / avgDeaths).toFixed(2) : 99;

  const champPool = shuffle(CHAMPIONS).slice(0, randInt(5, 10));
  const byChampion = {};
  const roleForChamp = (i) => mainRoles[i % mainRoles.length] || pick(ROLES);

  champPool.forEach((name, i) => {
    const games = randInt(10, 50);
    byChampion[name] = {
      games,
      winrate: rand(40 + mult * 5, 55 + mult * 10),
      avgKDA: rand(1.5 + mult, 3 + mult * 2),
      avgCSPerMin: rand(5 + mult * 1.5, 7 + mult * 2),
      avgDamagePerMin: rand(400 + mult * 200, 700 + mult * 300),
      avgGoldPerMin: rand(300 + mult * 100, 450 + mult * 150),
      avgVisionPerMin: rand(0.5 + mult * 0.3, 1.2 + mult * 0.5),
      avgKP: rand(45 + mult * 5, 65 + mult * 10),
      avgKills: rand(3 + mult, 7 + mult * 2),
      avgDeaths: rand(3, 6 - mult),
      avgAssists: rand(4 + mult, 9 + mult * 2),
      mainRole: roleForChamp(i),
      avgSoloKills: rand(0.3 + mult * 0.3, 1.5 + mult * 0.5),
      firstBloodRate: rand(10 + mult * 5, 25 + mult * 10),
      avgControlWards: rand(1 + mult * 0.5, 4 + mult),
      topItems: [
        { id: randInt(3000, 3200), count: randInt(10, 30) },
        { id: randInt(3000, 3200), count: randInt(5, 20) },
        { id: randInt(3000, 3200), count: randInt(3, 15) },
      ],
    };
  });

  const byRole = {};
  ROLES.forEach(r => {
    const games = mainRoles.includes(r) ? randInt(30, 100) : randInt(2, 20);
    byRole[r] = { games, winrate: rand(42 + mult * 5, 55 + mult * 10), avgKDA: rand(1.5 + mult, 3.5 + mult * 1.5) };
  });

  const playstyleTypes = ['aggressive', 'defensive', 'farming', 'teamplay'];
  const tags = shuffle(['Early aggressor', 'Late scaler', 'Vision control', 'Roamer', 'Split pusher', 'Engage', 'Peel', 'Dive']).slice(0, 3);

  const strengths = [
    { key: 'kda', label: 'KDA', value: avgKDA, benchmark: 2.5, desc: 'Ratio KDA au-dessus de la moyenne' },
    { key: 'cs', label: 'CS/min', value: rand(6 + mult, 8 + mult * 1.5), benchmark: 7.0, desc: 'Bonne gestion des sbires' },
    { key: 'vision', label: 'Vision/min', value: rand(0.8 + mult * 0.3, 1.5 + mult * 0.5), benchmark: 1.0, desc: 'Bon controle de vision' },
  ];
  const weaknesses = [
    { key: 'deaths', label: 'Morts/game', value: avgDeaths, benchmark: 5.0, desc: 'Trop de morts en moyenne' },
    { key: 'early', label: 'CS@10', value: rand(55 + mult * 10, 70 + mult * 10), benchmark: 80, desc: 'Farming early a ameliorer' },
  ];

  return {
    overview: {
      totalGames, winrate, avgKDA, avgKills, avgDeaths, avgAssists,
      avgCSPerMin: rand(5.5 + mult * 1.5, 7.5 + mult * 2),
      avgVisionPerMin: rand(0.5 + mult * 0.3, 1.2 + mult * 0.5),
      avgDamageShare: rand(18 + mult * 3, 28 + mult * 5),
      avgGoldPerMin: rand(320 + mult * 80, 450 + mult * 120),
      avgKillParticipation: rand(50 + mult * 5, 70 + mult * 8),
      avgDamagePerMin: rand(450 + mult * 200, 750 + mult * 300),
      avgDeathsPerGame: avgDeaths,
      avgControlWardsBought: rand(1.5 + mult, 5 + mult * 2),
    },
    byChampion,
    byRole,
    playstyle: {
      type: pick(playstyleTypes),
      tags,
      scores: {
        aggressive: randInt(2 + Math.floor(mult * 2), 8),
        defensive: randInt(2, 7 + Math.floor(mult)),
        farming: randInt(3 + Math.floor(mult * 2), 9),
        teamplay: randInt(3, 8 + Math.floor(mult)),
        vision: randInt(2 + Math.floor(mult), 8),
        earlyGame: randInt(2 + Math.floor(mult), 8),
      },
    },
    strengths,
    weaknesses,
    earlyGame: {
      avgCSAt10: rand(55 + mult * 15, 75 + mult * 15),
      firstBloodRate: rand(10 + mult * 5, 25 + mult * 10),
      avgTurretPlates: rand(0.5 + mult * 0.5, 2 + mult),
      avgSoloKills: rand(0.2 + mult * 0.3, 1 + mult * 0.5),
    },
    trends: {
      recentWinrate: rand(winrate - 5, winrate + 10),
      previousWinrate: winrate,
      kdaTrend: pick(['up', 'down', 'stable']),
      recentCS: rand(6 + mult, 8 + mult * 1.5),
      prevCS: rand(5.5 + mult, 7.5 + mult * 1.5),
      csTrend: pick(['up', 'down', 'stable']),
    },
    synergies: champPool.slice(0, 3).map(c => ({
      champion: c,
      matchedWith: shuffle(CHAMPIONS).slice(0, 2),
      score: rand(60, 85),
    })),
    damageComposition: {
      physical: randInt(30, 60),
      magic: randInt(20, 50),
      true: randInt(5, 20),
    },
    topChampions: champPool.slice(0, 5).map(c => ({
      championName: c,
      masteryLevel: randInt(4, 7),
      masteryPoints: randInt(20000, 500000),
    })),
    matchHistory: [],
  };
}

// ─── Data definitions ────────────────────────────────────────

const SERVERS = [
  { guild_id: '100000000000000001', guild_name: 'Rift Academy', guild_icon: null, licensed: true, public: true, owner_key: 'owner1' },
  { guild_id: '100000000000000002', guild_name: 'Nexus Legends', guild_icon: null, licensed: true, public: true, owner_key: 'owner2' },
  { guild_id: '100000000000000003', guild_name: 'Baron Nashor Club', guild_icon: null, licensed: true, public: true, owner_key: 'owner3' },
  { guild_id: '100000000000000004', guild_name: 'Summoner School FR', guild_icon: null, licensed: true, public: true, owner_key: 'owner4' },
  { guild_id: '100000000000000005', guild_name: 'La Faille', guild_icon: null, licensed: true, public: true, owner_key: 'owner5' },
  { guild_id: '100000000000000006', guild_name: 'Pentakill Esport', guild_icon: null, licensed: true, public: false, owner_key: 'owner6' },
];

const PLAYERS = [
  // 6 owners (Diamond-Master) — owner_key links to SERVERS[].owner_key
  { name: 'Zephyr', tag: 'EUW', key: 'owner1', rank: 'DIAMOND', div: 'II', roles: ['MID', 'ADC'], style: 'tryhard', isOwner: true },
  { name: 'NightBloom', tag: '0001', key: 'owner2', rank: 'MASTER', div: null, roles: ['ADC', 'MID'], style: 'tryhard', isOwner: true },
  { name: 'Kaelthys', tag: 'FR', key: 'owner3', rank: 'DIAMOND', div: 'I', roles: ['MID'], style: 'tryhard', isOwner: true },
  { name: 'RuneForge', tag: 'EUW', key: 'owner4', rank: 'DIAMOND', div: 'III', roles: ['JUNGLE', 'MID'], style: 'tryhard', isOwner: true },
  { name: 'Volcrest', tag: '1337', key: 'owner5', rank: 'MASTER', div: null, roles: ['TOP', 'JUNGLE'], style: 'tryhard', isOwner: true },
  { name: 'Sorael', tag: 'SUP', key: 'owner6', rank: 'DIAMOND', div: 'IV', roles: ['SUPPORT'], style: 'chill', isOwner: true },
  // 19 joueurs reguliers — pseudos LoL realistes
  { name: 'xXDarkGarenXx', tag: 'EUW', key: 'p1', rank: 'IRON', div: 'II', roles: ['TOP'], style: 'chill' },
  { name: 'JungleDiff69', tag: 'FR', key: 'p2', rank: 'BRONZE', div: 'I', roles: ['JUNGLE', 'TOP'], style: 'chill' },
  { name: 'MissCanon', tag: '0042', key: 'p3', rank: 'SILVER', div: 'III', roles: ['ADC'], style: 'tryhard' },
  { name: 'Lux Aeterna', tag: 'EUW', key: 'p4', rank: 'SILVER', div: 'I', roles: ['MID', 'TOP'], style: 'tryhard' },
  { name: 'WardBot', tag: 'SUP', key: 'p5', rank: 'SILVER', div: 'II', roles: ['SUPPORT', 'MID'], style: 'chill' },
  { name: 'LeSmiteur', tag: 'FR', key: 'p6', rank: 'SILVER', div: 'IV', roles: ['JUNGLE'], style: 'tryhard' },
  { name: 'crit happens', tag: '2026', key: 'p7', rank: 'SILVER', div: 'I', roles: ['ADC', 'MID'], style: 'chill' },
  { name: 'Orianna Bot', tag: 'MID', key: 'p8', rank: 'GOLD', div: 'II', roles: ['MID'], style: 'tryhard' },
  { name: 'FlashOnD', tag: 'EUW', key: 'p9', rank: 'GOLD', div: 'I', roles: ['ADC', 'SUPPORT'], style: 'tryhard' },
  { name: 'TiltProof', tag: 'LOL', key: 'p10', rank: 'GOLD', div: 'III', roles: ['TOP', 'JUNGLE'], style: 'chill' },
  { name: 'PeelForMe', tag: 'FR', key: 'p11', rank: 'GOLD', div: 'IV', roles: ['SUPPORT'], style: 'chill' },
  { name: 'Ganks a lot', tag: 'JGL', key: 'p12', rank: 'GOLD', div: 'I', roles: ['JUNGLE', 'MID'], style: 'tryhard' },
  { name: 'Syndra Mains', tag: 'EUW', key: 'p13', rank: 'PLATINUM', div: 'II', roles: ['MID', 'ADC'], style: 'tryhard' },
  { name: 'Le Grull', tag: '0033', key: 'p14', rank: 'PLATINUM', div: 'I', roles: ['TOP'], style: 'tryhard' },
  { name: 'Vayne Spotting', tag: 'BOT', key: 'p15', rank: 'PLATINUM', div: 'III', roles: ['ADC', 'MID'], style: 'chill' },
  { name: 'Roaming TV', tag: 'SUP', key: 'p16', rank: 'PLATINUM', div: 'IV', roles: ['SUPPORT', 'JUNGLE'], style: 'chill' },
  { name: 'K4ssadin', tag: 'EUW', key: 'p17', rank: 'DIAMOND', div: 'III', roles: ['MID'], style: 'tryhard' },
  { name: 'Draven Enjoyer', tag: 'FR', key: 'p18', rank: 'DIAMOND', div: 'I', roles: ['ADC', 'MID'], style: 'tryhard' },
  { name: 'Shaker', tag: '9999', key: 'p19', rank: 'CHALLENGER', div: null, roles: ['MID', 'ADC'], style: 'tryhard' },
];

const LFG_NOTES = [
  'Gold+ chill normals ce soir',
  'Cherche duo ranked tryhard, vocal obligatoire',
  'ARAM entre potes, venez !',
  'Clash ce week-end, on cherche un mid',
  'Flex 5 stack, Silver-Gold, ambiance cool',
  'Duo bot lane, je suis support main',
  'Cherche jungler pour grimper en Gold',
  'Normal draft detente, tout rank bienvenu',
];

// ─── Main seed function ──────────────────────────────────────

async function seed() {
  console.log('=== LEZGO SEED SCRIPT ===\n');

  // 1. Clean up existing fake data
  console.log('[1/7] Nettoyage des donnees fake existantes...');

  // First, clean up by riot_puuid pattern in profiles
  const { data: fakeProfiles } = await supabase
    .from('profiles')
    .select('id, riot_puuid')
    .like('riot_puuid', `${FAKE_PUUID_PREFIX}%`);

  if (fakeProfiles && fakeProfiles.length > 0) {
    const fakeIds = fakeProfiles.map(p => p.id);
    await supabase.from('tournament_participants').delete().in('user_id', fakeIds);
    await supabase.from('lfg_posts').delete().in('user_id', fakeIds);
    await supabase.from('server_members').delete().in('user_id', fakeIds);
    await supabase.from('profiles').delete().in('id', fakeIds);
    for (const p of fakeProfiles) {
      try { await supabase.auth.admin.deleteUser(p.id); } catch {}
    }
    console.log(`  Supprime ${fakeProfiles.length} fake profiles`);
  }

  // Also clean up orphaned auth users with @fake.lezgo.gg emails (from previous failed seeds)
  const { data: authList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (authList?.users) {
    const fakeAuthUsers = authList.users.filter(u => u.email && u.email.endsWith('@fake.lezgo.gg'));
    for (const u of fakeAuthUsers) {
      // Delete profile if it exists (may not exist if previous seed failed)
      await supabase.from('profiles').delete().eq('id', u.id);
      await supabase.auth.admin.deleteUser(u.id);
    }
    if (fakeAuthUsers.length > 0) {
      console.log(`  Supprime ${fakeAuthUsers.length} fake auth users orphelins`);
    }
  }

  // Clean fake servers
  const fakeGuildIds = SERVERS.map(s => s.guild_id);
  const { data: fakeServerRows } = await supabase.from('servers').select('id').in('guild_id', fakeGuildIds);
  const fakeServerIds = (fakeServerRows || []).map(s => s.id);

  if (fakeServerIds.length > 0) {
    // Get tournament IDs for these servers
    const { data: fakeTournaments } = await supabase.from('tournaments').select('id').in('server_id', fakeServerIds);
    const fakeTournamentIds = (fakeTournaments || []).map(t => t.id);

    if (fakeTournamentIds.length > 0) {
      // Delete participants before tournaments (FK order)
      await supabase.from('tournament_participants').delete().in('tournament_id', fakeTournamentIds);
      await supabase.from('tournament_requests').delete().in('tournament_id', fakeTournamentIds);
    }
    await supabase.from('tournaments').delete().in('server_id', fakeServerIds);
    await supabase.from('server_members').delete().in('server_id', fakeServerIds);
    await supabase.from('lfg_posts').delete().in('server_id', fakeServerIds);
  }
  // Delete server_requests linked to fake guild_ids
  await supabase.from('server_requests').delete().in('guild_id', fakeGuildIds);
  await supabase.from('servers').delete().in('guild_id', fakeGuildIds);
  console.log('  Serveurs fake nettoyes');

  // 2. Create servers (owner_discord_id will be set after profiles are created)
  console.log('\n[2/8] Creation des serveurs...');
  const serverMap = {}; // guild_id -> server row
  for (const s of SERVERS) {
    const now = new Date();
    const expires = new Date(now);
    expires.setMonth(expires.getMonth() + 6);
    const { data, error } = await supabase
      .from('servers')
      .upsert({
        guild_id: s.guild_id,
        guild_name: s.guild_name,
        guild_icon: s.guild_icon,
        owner_discord_id: `fake_discord_${s.owner_key}`,
        licensed: s.licensed,
        public: s.public,
        license_label: 'Standard',
        license_price: 29.99,
        license_started_at: now.toISOString(),
        license_expires_at: expires.toISOString(),
      }, { onConflict: 'guild_id' })
      .select()
      .single();
    if (error) { console.error(`  Erreur serveur ${s.guild_name}:`, error.message); continue; }
    serverMap[s.guild_id] = data;
    console.log(`  + ${data.guild_name} (${data.id})`);
  }

  // 3. Create fake users & profiles
  console.log('\n[3/8] Creation des profils joueurs...');
  const profileMap = {}; // key -> { userId, profile, player }
  for (const p of PLAYERS) {
    const fakeEmail = `${p.key}@fake.lezgo.gg`;
    const password = 'FakePassword123!';
    const discordId = `fake_discord_${p.key}`;

    // Create auth user
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: fakeEmail,
      password,
      email_confirm: true,
      user_metadata: {
        provider_id: discordId,
        full_name: p.name,
        avatar_url: '',
      },
    });

    if (authErr) {
      console.error(`  Erreur auth ${p.name}:`, authErr.message);
      continue;
    }

    const userId = authData.user.id;
    const analytics = generateAnalytics(p.rank, p.roles);
    const schedules = shuffle(SCHEDULES).slice(0, randInt(1, 3));

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        discord_id: discordId,
        discord_username: p.name,
        discord_avatar: '',
        riot_game_name: p.name,
        riot_tag_line: p.tag,
        riot_puuid: `${FAKE_PUUID_PREFIX}${p.key}`,
        rank_tier: p.rank,
        rank_division: p.div,
        roles: p.roles,
        schedule: schedules,
        play_style: p.style,
        analytics,
        last_analyzed_at: pastDate(randInt(1, 14)),
      }, { onConflict: 'id' })
      .select()
      .single();

    if (profErr) {
      console.error(`  Erreur profil ${p.name}:`, profErr.message);
      continue;
    }

    profileMap[p.key] = { userId, profile, player: p };
    console.log(`  + ${p.name}#${p.tag} (${p.rank} ${p.div || ''}) [${userId.slice(0, 8)}]`);
  }

  // 4. Create memberships
  console.log('\n[4/8] Creation des memberships...');
  const allServerIds = Object.values(serverMap).map(s => s.id);
  const serverEntries = Object.entries(serverMap);
  let memberCount = 0;

  for (const [key, { userId, player }] of Object.entries(profileMap)) {
    // Owners join their own server
    const ownerServer = player.isOwner ? SERVERS.find(s => s.owner_key === player.key) : null;
    const joinedServerIds = new Set();

    if (ownerServer && serverMap[ownerServer.guild_id]) {
      const serverId = serverMap[ownerServer.guild_id].id;
      await supabase.from('server_members').upsert(
        { server_id: serverId, user_id: userId },
        { onConflict: 'server_id,user_id' }
      );
      joinedServerIds.add(serverId);
      memberCount++;
    }

    // Each player joins 1-3 random servers
    const numExtra = randInt(1, 3);
    const shuffled = shuffle(serverEntries);
    for (let i = 0; i < numExtra && i < shuffled.length; i++) {
      const serverId = shuffled[i][1].id;
      if (joinedServerIds.has(serverId)) continue;
      await supabase.from('server_members').upsert(
        { server_id: serverId, user_id: userId },
        { onConflict: 'server_id,user_id' }
      );
      joinedServerIds.add(serverId);
      memberCount++;
    }
  }
  console.log(`  ${memberCount} memberships crees`);

  // 5. Create server_requests (active) for each owner → enables streamer dashboard
  console.log('\n[5/8] Creation des server_requests pour les owners...');
  // Also clean any previous fake server_requests
  for (const s of SERVERS) {
    const server = serverMap[s.guild_id];
    if (!server) continue;
    await supabase.from('server_requests').delete().eq('guild_id', s.guild_id);
  }

  for (const s of SERVERS) {
    const server = serverMap[s.guild_id];
    const ownerProfile = profileMap[s.owner_key];
    if (!server || !ownerProfile) continue;

    const { error } = await supabase.from('server_requests').insert({
      user_id: ownerProfile.userId,
      discord_id: `fake_discord_${s.owner_key}`,
      discord_username: ownerProfile.player.name,
      discord_avatar: '',
      guild_id: s.guild_id,
      guild_name: s.guild_name,
      guild_icon: s.guild_icon,
      status: 'active',
      server_id: server.id,
      license_label: 'Standard',
      license_price: 29.99,
      license_months: 6,
    });

    if (error) { console.error(`  Erreur request ${s.guild_name}:`, error.message); continue; }
    console.log(`  + ${s.guild_name} → owner ${ownerProfile.player.name}`);
  }

  // 5b. Link real admin account as co-owner of Rift Academy (for demo)
  const REAL_ADMIN_DISCORD_ID = '713053980464513147';
  const riftAcademy = serverMap['100000000000000001'];
  if (riftAcademy) {
    // Find the real admin profile by discord_id
    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('id, discord_id, discord_username')
      .eq('discord_id', REAL_ADMIN_DISCORD_ID)
      .maybeSingle();

    if (adminProfile) {
      // Add admin as member of Rift Academy
      await supabase.from('server_members').upsert(
        { server_id: riftAcademy.id, user_id: adminProfile.id },
        { onConflict: 'server_id,user_id' }
      );

      // Create active server_request so Espace Streamer shows management UI
      await supabase.from('server_requests').delete()
        .eq('user_id', adminProfile.id)
        .eq('guild_id', '100000000000000001');

      await supabase.from('server_requests').insert({
        user_id: adminProfile.id,
        discord_id: REAL_ADMIN_DISCORD_ID,
        discord_username: adminProfile.discord_username || 'Admin',
        discord_avatar: '',
        guild_id: '100000000000000001',
        guild_name: 'Rift Academy',
        guild_icon: null,
        status: 'active',
        server_id: riftAcademy.id,
        license_label: 'Standard',
        license_price: 29.99,
        license_months: 6,
      });
      console.log(`  + Real admin (${adminProfile.discord_username || REAL_ADMIN_DISCORD_ID}) → owner Rift Academy (demo)`);
    } else {
      console.log('  (!) Admin profile not found — log in once with Discord first');
    }
  }

  // 6. Create LFG posts
  console.log('\n[6/8] Creation des LFG posts...');
  const profileEntries = Object.entries(profileMap);
  const lfgPlayers = shuffle(profileEntries).slice(0, 8);

  for (let i = 0; i < lfgPlayers.length; i++) {
    const [, { userId }] = lfgPlayers[i];
    // Find a server the user is a member of
    const { data: membership } = await supabase
      .from('server_members')
      .select('server_id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (!membership) continue;

    const { error } = await supabase.from('lfg_posts').insert({
      server_id: membership.server_id,
      user_id: userId,
      wanted_role: Math.random() > 0.3 ? pick(ROLES) : null,
      note: LFG_NOTES[i % LFG_NOTES.length],
      expires_at: futureDate(rand(0.05, 0.12)), // 1-3 hours from now
    });

    if (error) console.error(`  Erreur LFG:`, error.message);
    else console.log(`  + LFG post #${i + 1}`);
  }

  // 7. Create tournaments
  console.log('\n[7/8] Creation des tournois...');
  const riftServer = serverMap['100000000000000001'];    // Rift Academy
  const nexusServer = serverMap['100000000000000002'];   // Nexus Legends
  const baronServer = serverMap['100000000000000003'];   // Baron Nashor Club
  const summonerServer = serverMap['100000000000000004'];// Summoner School FR
  const failleServer = serverMap['100000000000000005'];  // La Faille

  const ownerRift = profileMap['owner1'];
  const ownerNexus = profileMap['owner2'];
  const ownerFaille = profileMap['owner5'];

  const TOURNAMENTS = [
    {
      title: 'Rift Academy Weekly',
      description: 'Tournoi hebdomadaire ouvert a tous les membres. Venez montrer vos skills !',
      format: '5v5',
      server_id: riftServer.id,
      created_by: ownerRift?.userId || null,
      max_participants: 32,
      rank_min: 'SILVER',
      rank_max: 'DIAMOND',
      prize: '20 EUR de RP',
      rules: 'Draft pick, pas de remake avant 3 min, FF15 autorise.',
      status: 'open',
      is_cross_community: false,
      starts_at: futureDate(3),
      ends_at: futureDate(3.2),
    },
    {
      title: 'Nexus 1v1 Championship',
      description: 'Le 1v1 ultime ! Premier sang ou 100 CS gagne.',
      format: '1v1',
      server_id: nexusServer.id,
      created_by: ownerNexus?.userId || null,
      max_participants: 64,
      rank_min: null,
      rank_max: null,
      prize: 'Skin Legendary au choix',
      rules: '1v1 sur Howling Abyss. First blood ou 100 CS. Aucun back autorise.',
      status: 'open',
      is_cross_community: false,
      starts_at: futureDate(5),
      ends_at: futureDate(5.1),
    },
    {
      title: 'Rift x Nexus Showdown',
      description: 'Grand affrontement inter-communautes ! 5v5 draft pick, best of 3.',
      format: '5v5',
      server_id: riftServer.id,
      partner_server_id: nexusServer.id,
      created_by: ownerRift?.userId || null,
      max_participants: 20,
      rank_min: 'GOLD',
      rank_max: 'MASTER',
      prize: '50 EUR de RP par equipe gagnante',
      rules: '5v5 Draft pick, Bo3, vocal Discord obligatoire.',
      status: 'open',
      is_cross_community: true,
      starts_at: futureDate(7),
      ends_at: futureDate(7.3),
    },
    {
      title: 'Baron Nashor Cup',
      description: 'La Coupe du Baron - edition terminee. GG a tous les participants !',
      format: '5v5',
      server_id: baronServer.id,
      created_by: profileMap['owner3']?.userId || null,
      max_participants: 32,
      rank_min: 'GOLD',
      rank_max: null,
      prize: '100 EUR',
      rules: 'Tournoi 5v5, elimination simple.',
      status: 'completed',
      is_cross_community: false,
      starts_at: pastDate(10),
      ends_at: pastDate(9.5),
    },
    {
      title: 'Summoner School Replay Review',
      description: 'Tournoi en cours ! Analysez vos replays entre les matchs pour progresser.',
      format: '5v5',
      server_id: summonerServer.id,
      created_by: profileMap['owner4']?.userId || null,
      max_participants: 16,
      rank_min: 'PLATINUM',
      rank_max: null,
      prize: 'Coaching session avec un analyst',
      rules: 'Draft pick, chaque equipe doit soumettre un replay entre les rounds.',
      status: 'in_progress',
      is_cross_community: false,
      starts_at: pastDate(1),
      ends_at: futureDate(1),
    },
    {
      title: 'La Faille x Rift Academy 2v2',
      description: 'Tournoi 2v2 cross-communaute. En attente de confirmation du partenaire.',
      format: '2v2',
      server_id: failleServer.id,
      created_by: ownerFaille?.userId || null,
      max_participants: 24,
      rank_min: 'SILVER',
      rank_max: 'PLATINUM',
      prize: '30 EUR de RP',
      rules: '2v2 sur Howling Abyss, elimination double.',
      status: 'pending_partner',
      is_cross_community: true,
      starts_at: futureDate(14),
      ends_at: futureDate(14.2),
    },
  ];

  const tournamentMap = {};
  for (const t of TOURNAMENTS) {
    const { data, error } = await supabase.from('tournaments').insert(t).select().single();
    if (error) { console.error(`  Erreur tournoi ${t.title}:`, error.message); continue; }
    tournamentMap[t.title] = data;
    console.log(`  + ${data.title} (${data.status})`);
  }

  // 8. Create tournament requests for cross-community
  console.log('\n[8/8] Creation des tournament requests + participants...');

  // Rift x Nexus Showdown — accepted
  const showdown = tournamentMap['Rift x Nexus Showdown'];
  if (showdown) {
    await supabase.from('tournament_requests').insert({
      tournament_id: showdown.id,
      from_server_id: riftServer.id,
      to_server_id: nexusServer.id,
      requested_by: ownerRift?.userId || null,
      status: 'accepted',
      message: 'On organise un showdown inter-communautes, ca vous dit ?',
      responded_at: pastDate(2),
    });
    console.log('  + Request: Rift Academy → Nexus Legends (accepted)');
  }

  // La Faille x Rift Academy 2v2 — pending (targets Rift Academy so admin can demo accept)
  const failleRift = tournamentMap['La Faille x Rift Academy 2v2'];
  if (failleRift) {
    await supabase.from('tournament_requests').insert({
      tournament_id: failleRift.id,
      from_server_id: failleServer.id,
      to_server_id: riftServer.id,
      requested_by: ownerFaille?.userId || null,
      status: 'pending',
      message: '2v2 entre nos communautes, ca vous tente ?',
    });
    console.log('  + Request: La Faille → Rift Academy (pending)');
  }

  // Add participants to tournaments
  const allProfileEntries = Object.entries(profileMap);

  for (const [title, tournament] of Object.entries(tournamentMap)) {
    if (!tournament) continue;
    const numParticipants = randInt(3, 15);
    const candidates = shuffle(allProfileEntries).slice(0, numParticipants);

    for (const [, { userId }] of candidates) {
      // Determine which server_id the participant belongs to
      const { data: membership } = await supabase
        .from('server_members')
        .select('server_id')
        .eq('user_id', userId)
        .in('server_id', [tournament.server_id, tournament.partner_server_id].filter(Boolean))
        .limit(1)
        .maybeSingle();

      const participantStatus = tournament.status === 'completed'
        ? pick(['eliminated', 'winner', 'eliminated', 'eliminated'])
        : tournament.status === 'in_progress'
        ? pick(['registered', 'checked_in', 'eliminated'])
        : 'registered';

      const { error } = await supabase.from('tournament_participants').insert({
        tournament_id: tournament.id,
        user_id: userId,
        server_id: membership?.server_id || tournament.server_id,
        status: participantStatus,
      });
      if (error && !error.message.includes('duplicate')) {
        // Ignore duplicate key errors
      }
    }
    console.log(`  + ${title}: ~${numParticipants} participants`);
  }

  console.log('\n=== SEED TERMINE ===');
  console.log(`Serveurs: ${SERVERS.length}`);
  console.log(`Profils: ${PLAYERS.length}`);
  console.log(`Tournois: ${TOURNAMENTS.length}`);
  console.log(`LFG posts: ${lfgPlayers.length}`);
}

seed().catch(err => {
  console.error('SEED ERROR:', err);
  process.exit(1);
});
