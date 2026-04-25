const DEDUPE_FIELD_COUNT = 3;

function extractDedupeKey(content) {
  if (!content) return '';
  return content.split('|').slice(0, DEDUPE_FIELD_COUNT).join('|');
}

module.exports = { extractDedupeKey, DEDUPE_FIELD_COUNT };
