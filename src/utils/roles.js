const { createLogger } = require('./logger');

const log = createLogger('roles');

async function assignRole(guild, userId, roleId, reason = 'auto-assign') {
  if (!roleId || roleId.startsWith('paste_') || roleId === 'role_given_to_verified_buyers' || roleId === 'role_given_to_every_new_joiner') {
    return { skipped: true, reason: 'role id not configured' };
  }

  try {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      log.warn(`role ${roleId} not found in guild ${guild.name}`);
      return { failed: true, reason: 'role not found' };
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      log.warn(`member ${userId} not in guild ${guild.name}`);
      return { failed: true, reason: 'member not in guild' };
    }

    if (member.roles.cache.has(roleId)) {
      return { skipped: true, reason: 'already has role' };
    }

    await member.roles.add(role, reason);
    log.info(`assigned role @${role.name} to ${member.user.tag} (${reason})`);
    return { assigned: true, member, role };
  } catch (err) {
    log.warn(`assignRole failed (${reason}): ${err.message}`);
    return { failed: true, error: err };
  }
}

async function assignRoleAcrossGuilds(client, userId, roleId, reason = 'auto-assign') {
  if (!roleId) return [];
  const results = [];
  for (const guild of client.guilds.cache.values()) {
    const result = await assignRole(guild, userId, roleId, reason);
    results.push({ guildId: guild.id, ...result });
  }
  return results;
}

module.exports = { assignRole, assignRoleAcrossGuilds };
