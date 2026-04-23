const { Events, MessageFlags } = require('discord.js');
const { createLogger } = require('../utils/logger');

const log = createLogger('interaction');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (interaction.isButton()) {
      const [domain, action, ...rest] = interaction.customId.split(':');
      if (domain === 'ticket') {
        try {
          const { handleTicketButton } = require('../handlers/ticketButtons');
          await handleTicketButton(interaction, action, rest);
        } catch (err) {
          log.error(`ticket button ${interaction.customId} failed:`, err);
        }
        return;
      }
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (err) {
          if (err.code === 10062) {
            log.warn(`autocomplete /${interaction.commandName}: interaction expired (slow network)`);
          } else {
            log.error(`autocomplete /${interaction.commandName} failed:`, err);
          }
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      log.warn(`unknown command: /${interaction.commandName}`);
      return;
    }

    const userTag = `${interaction.user.tag} (${interaction.user.id})`;
    const started = Date.now();
    log.info(`/${interaction.commandName} by ${userTag}`);

    try {
      await command.execute(interaction);
      log.debug(`/${interaction.commandName} done in ${Date.now() - started}ms`);
    } catch (err) {
      log.error(`/${interaction.commandName} by ${userTag} failed:`, err);
      const payload = { content: 'Terjadi error. Coba lagi nanti.', flags: MessageFlags.Ephemeral };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch (replyErr) {
        log.error('failed to send error reply:', replyErr);
      }
    }
  },
};
