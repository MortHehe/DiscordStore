const { Events } = require('discord.js');
const { createLogger } = require('../utils/logger');
const { updatePanelNow, getPanelConfig, schedulePanelUpdate, startRefreshJob } = require('../services/panel');
const { startCleanupJob } = require('../services/inventory');
const { startPaymentPoller } = require('../services/paymentPoller');
const { startWebhookServer } = require('../services/webhookServer');

const log = createLogger('ready');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    log.info(`logged in as ${client.user.tag} (id=${client.user.id})`);
    log.info(`serving ${client.guilds.cache.size} guild(s)`);
    for (const g of client.guilds.cache.values()) {
      log.debug(`  - ${g.name} (id=${g.id}, members=${g.memberCount})`);
    }

    const panelConfig = await getPanelConfig();
    if (panelConfig) {
      log.info(`syncing panel in channel ${panelConfig.channelId}...`);
      await updatePanelNow(client);
    }

    startCleanupJob(client, {
      onRelease: async (c) => {
        schedulePanelUpdate(c);
      },
    });

    startRefreshJob(client);
    startPaymentPoller(client);
    startWebhookServer(client);
  },
};
