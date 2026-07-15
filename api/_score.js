// Golfi visitor scoring engine — deterministic, zero LLM cost.
// Computes a 0-100 intent score from a visitor's aggregated behaviour.

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * @param {object} v aggregated visitor stats
 *   sessionCount        - number of distinct visits
 *   pageViews           - total page_view events
 *   uniqueProperties    - distinct property pages viewed
 *   repeatPropertyViews - property views beyond the first for any property
 *   searchCount         - search/filter events
 *   totalSeconds        - cumulative time on site
 *   savedProperty       - bool, captured a property save
 *   exitIntentShown     - bool, exit-intent fired
 * @returns {{score:number, temperature:string, breakdown:object}}
 */
function computeScore(v) {
  const b = {
    returnVisits:  clamp((v.sessionCount || 0) * 15, 0, 30),
    pagesViewed:   clamp((v.pageViews || 0) * 3, 0, 20),
    properties:    clamp((v.uniqueProperties || 0) * 8, 0, 24),
    repeatViews:   clamp((v.repeatPropertyViews || 0) * 6, 0, 18),
    searches:      clamp((v.searchCount || 0) * 5, 0, 15),
    timeOnSite:    clamp(Math.floor((v.totalSeconds || 0) / 60) * 2, 0, 20),
    savedBonus:    v.savedProperty ? 15 : 0,
    exitBonus:     v.exitIntentShown ? 10 : 0,
  };
  const score = clamp(
    Object.values(b).reduce((a, x) => a + x, 0),
    0, 100
  );
  return { score, temperature: bandFor(score), breakdown: b };
}

function bandFor(score) {
  if (score >= 61) return 'hot';
  if (score >= 26) return 'warm';
  return 'cold';
}

/**
 * Aggregate a raw events array (from the events table) into scoring stats.
 * @param {Array<{type:string,data:object,created_at:string}>} events
 * @param {number} sessionCount
 */
function aggregateEvents(events, sessionCount) {
  const propViewCounts = {};
  let pageViews = 0, searchCount = 0, savedProperty = false, exitIntentShown = false;
  let firstTs = null, lastTs = null;

  for (const e of events || []) {
    const ts = new Date(e.created_at).getTime();
    if (firstTs === null || ts < firstTs) firstTs = ts;
    if (lastTs === null || ts > lastTs) lastTs = ts;

    switch (e.type) {
      case 'page_view':     pageViews++; break;
      case 'property_view': {
        const id = (e.data && e.data.propertyId) || 'unknown';
        propViewCounts[id] = (propViewCounts[id] || 0) + 1;
        break;
      }
      case 'search':        searchCount++; break;
      case 'property_save':
      case 'lead_property_save': savedProperty = true; break;
      case 'exit_intent':   exitIntentShown = true; break;
    }
  }

  const uniqueProperties = Object.keys(propViewCounts).length;
  const repeatPropertyViews = Object.values(propViewCounts)
    .reduce((a, c) => a + Math.max(0, c - 1), 0);
  const totalSeconds = firstTs && lastTs ? Math.round((lastTs - firstTs) / 1000) : 0;

  return {
    sessionCount: sessionCount || 1,
    pageViews,
    uniqueProperties,
    repeatPropertyViews,
    searchCount,
    totalSeconds,
    savedProperty,
    exitIntentShown,
  };
}

module.exports = { computeScore, bandFor, aggregateEvents };
