// Golfi visitor scoring engine — deterministic, zero LLM cost.
// Computes a 0-100 intent score from a visitor's aggregated behaviour.

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

const DEFAULT_WEIGHTS = {
  returnVisitPoints: 15, returnVisitCap: 30,
  pageViewPoints: 3,     pageViewCap: 20,
  propertyPoints: 8,     propertyCap: 24,
  repeatViewPoints: 6,   repeatViewCap: 18,
  searchPoints: 5,       searchCap: 15,
  timePointsPerMin: 2,   timeCap: 20,
  savedBonus: 15,
  exitBonus: 10,
  hotThreshold: 61,
  warmThreshold: 26,
};

// Merge caller-supplied weights over the defaults, ignoring anything non-numeric
// so a partial or malformed settings object can never break scoring.
function resolveWeights(weights) {
  const w = { ...DEFAULT_WEIGHTS };
  if (weights) {
    for (const k of Object.keys(DEFAULT_WEIGHTS)) {
      const v = weights[k];
      if (typeof v === 'number' && Number.isFinite(v)) w[k] = v;
    }
  }
  return w;
}

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
 * @param {object} [weights] optional DB-configured weights; falls back to DEFAULT_WEIGHTS
 * @returns {{score:number, temperature:string, breakdown:object}}
 */
function computeScore(v, weights) {
  const w = resolveWeights(weights);
  const b = {
    returnVisits:  clamp((v.sessionCount || 0) * w.returnVisitPoints, 0, w.returnVisitCap),
    pagesViewed:   clamp((v.pageViews || 0) * w.pageViewPoints, 0, w.pageViewCap),
    properties:    clamp((v.uniqueProperties || 0) * w.propertyPoints, 0, w.propertyCap),
    repeatViews:   clamp((v.repeatPropertyViews || 0) * w.repeatViewPoints, 0, w.repeatViewCap),
    searches:      clamp((v.searchCount || 0) * w.searchPoints, 0, w.searchCap),
    timeOnSite:    clamp(Math.floor((v.totalSeconds || 0) / 60) * w.timePointsPerMin, 0, w.timeCap),
    savedBonus:    v.savedProperty ? w.savedBonus : 0,
    exitBonus:     v.exitIntentShown ? w.exitBonus : 0,
  };
  const score = clamp(
    Object.values(b).reduce((a, x) => a + x, 0),
    0, 100
  );
  return { score, temperature: bandFor(score, weights), breakdown: b };
}

function bandFor(score, weights) {
  const w = resolveWeights(weights);
  if (score >= w.hotThreshold) return 'hot';
  if (score >= w.warmThreshold) return 'warm';
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
