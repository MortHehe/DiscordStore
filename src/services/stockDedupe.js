const { collections } = require('../db');
const { DEDUPE_FIELD_COUNT } = require('../utils/stockKey');
const { createLogger } = require('../utils/logger');

const log = createLogger('stockDedupe');

async function findDuplicates(productId = null) {
  const match = { sold: false };
  if (productId) match.productId = productId;

  return collections.stock().aggregate([
    { $match: match },
    { $sort: { createdAt: 1 } },
    {
      $addFields: {
        dedupeKey: {
          $reduce: {
            input: { $slice: [{ $split: ['$content', '|'] }, DEDUPE_FIELD_COUNT] },
            initialValue: null,
            in: {
              $cond: [
                { $eq: ['$$value', null] },
                '$$this',
                { $concat: ['$$value', '|', '$$this'] },
              ],
            },
          },
        },
      },
    },
    {
      $group: {
        _id: { productId: '$productId', dedupeKey: '$dedupeKey' },
        ids: { $push: '$_id' },
        count: { $sum: 1 },
        sampleContent: { $first: '$content' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
}

async function removeAllDuplicates(productId = null) {
  const duplicates = await findDuplicates(productId);
  if (duplicates.length === 0) return { deletedCount: 0, groups: 0, keys: [] };

  const idsToDelete = duplicates.flatMap(d => d.ids);
  const keys = duplicates.map(d => d._id.dedupeKey);

  const result = await collections.stock().deleteMany({ _id: { $in: idsToDelete }, sold: false });

  if (result.deletedCount > 0) {
    log.warn(`purged ${result.deletedCount} duplicate stock items across ${duplicates.length} groups`);
  }
  return { deletedCount: result.deletedCount, groups: duplicates.length, keys };
}

module.exports = { findDuplicates, removeAllDuplicates };
