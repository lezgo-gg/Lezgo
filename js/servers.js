import { supabase } from './supabase.js';

/** Fetch all servers ordered by member count descending */
export async function loadAllServers() {
  const { data, error } = await supabase
    .from('servers')
    .select('*')
    .order('member_count', { ascending: false });

  if (error) throw error;
  return data || [];
}

/** Fetch members of a server with their profile data */
export async function loadServerMembers(serverId) {
  const { data, error } = await supabase
    .from('server_members')
    .select('*, profiles(*)')
    .eq('server_id', serverId)
    .order('joined_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(row => row.profiles).filter(Boolean);
}

/** Join a server by guild_id — looks up the server first */
export async function joinServerByGuildId(guildId, userId) {
  // Find the server row
  const { data: server, error: lookupErr } = await supabase
    .from('servers')
    .select('id')
    .eq('guild_id', guildId)
    .single();

  if (lookupErr || !server) throw new Error('Serveur introuvable');

  const { error } = await supabase
    .from('server_members')
    .upsert({ server_id: server.id, user_id: userId }, { onConflict: 'server_id,user_id' });

  if (error) throw error;
  return server.id;
}

/** Leave a server */
export async function leaveServer(serverId, userId) {
  const { error } = await supabase
    .from('server_members')
    .delete()
    .eq('server_id', serverId)
    .eq('user_id', userId);

  if (error) throw error;
}

/** Get servers the user has joined */
export async function getUserServers(userId) {
  const { data, error } = await supabase
    .from('server_members')
    .select('server_id, servers(*)')
    .eq('user_id', userId);

  if (error) throw error;
  return (data || []).map(row => row.servers).filter(Boolean);
}

/** Create an LFG post (expires in 3 hours) */
export async function createLfgPost(serverId, userId, wantedRole, note) {
  const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('lfg_posts')
    .insert({
      server_id: serverId,
      user_id: userId,
      wanted_role: wantedRole || null,
      note: (note || '').slice(0, 200),
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Get active (non-expired) LFG posts for a server, with profile data */
export async function getActiveLfgPosts(serverId) {
  const { data, error } = await supabase
    .from('lfg_posts')
    .select('*, profiles(*)')
    .eq('server_id', serverId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/** Delete an LFG post */
export async function deleteLfgPost(postId) {
  const { error } = await supabase
    .from('lfg_posts')
    .delete()
    .eq('id', postId);

  if (error) throw error;
}
