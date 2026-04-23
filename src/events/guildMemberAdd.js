const { Events } = require('discord.js');
const { createLogger } = require('../utils/logger');
const { assignRole } = require('../utils/roles');

const log = createLogger('event:memberAdd');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    log.info(`new member: ${member.user.tag} (${member.id}) joined ${member.guild.name}`);

    const roleId = process.env.NEW_MEMBER_ROLE_ID;
    if (!roleId) return;

    await assignRole(member.guild, member.id, roleId, 'auto-assign: new member');
  },
};
