// Synthetic QAV overlap unit test (red-team final Pilot-1 condition #1).
// Mirrors the allocation deployed in the weekly engine and Friday tracker.
// qavLow  = TRUE lower bound: max overlap - event-session sets nest, each session
//           counted once at its highest-value event.
// qavHigh = upper bound: events occupy distinct sessions where possible (capped at sessions).
const QAV_W = { Contact_Form: 1.0, Listing_Conversion: 1.0, Custom_Form: 0.6, User_Registration: 0.35, Click_To_Call: 0.25 };
const EV_ORDER = ['Contact_Form', 'Listing_Conversion', 'Custom_Form', 'User_Registration', 'Click_To_Call'];

function qavRange(sess, es) {
  let cumMax = 0, qLow = 0, remaining = sess, qHigh = 0;
  for (const ev of EV_ORDER) {
    const e = Math.min(es[ev] || 0, sess);
    const nLow = Math.max(0, e - cumMax); cumMax = Math.max(cumMax, e);
    const nHigh = Math.min(e, Math.max(0, remaining)); remaining -= nHigh;
    qLow += nLow * QAV_W[ev];
    qHigh += nHigh * QAV_W[ev];
  }
  return { qLow, qHigh };
}

const assert = (name, actual, expected) => {
  const ok = Math.abs(actual - expected) < 1e-9;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${actual} (expected ${expected})`);
  if (!ok) process.exitCode = 1;
};

// Reviewer's synthetic case: 100 sessions, 10 event-sessions of each type
let r = qavRange(100, { Contact_Form: 10, Listing_Conversion: 10, Custom_Form: 10, User_Registration: 10, Click_To_Call: 10 });
assert('qavLow (max overlap)', r.qLow, 10.0);
assert('qavHigh (no overlap)', r.qHigh, 32.0);

// Edge: event-sessions exceed total sessions - overlap forced even in the upper bound
r = qavRange(100, { Contact_Form: 40, Listing_Conversion: 40, Custom_Form: 40, User_Registration: 40, Click_To_Call: 40 });
assert('edge qavLow', r.qLow, 40.0);
assert('edge qavHigh (capped at 100 sessions)', r.qHigh, 92.0);
