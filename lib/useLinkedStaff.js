import { useEffect, useState } from "react";

/**
 * The staff member the signed-in user is linked to (Setup → Users), for entry screens to fill
 * in their staff and location fields: { _id, name, locationId, locationName } or null.
 *
 * Asked once a sign-in, and again after a few minutes, so moving between entry screens does not
 * ask each time but a changed link still arrives.
 */
const CACHE_MS = 5 * 60 * 1000;
let cached = null; // { userId, at, promise }

function loadLinkedStaff(userId) {
  if (cached && cached.userId === userId && Date.now() - cached.at < CACHE_MS) return cached.promise;
  const promise = fetch("/api/auth/my-staff")
    .then((res) => (res.ok ? res.json() : { staff: null }))
    .then((data) => data?.staff || null)
    .catch(() => null);
  cached = { userId, at: Date.now(), promise };
  return promise;
}

export function useLinkedStaff(userId) {
  const [state, setState] = useState({ linkedStaff: null, loaded: false });

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    loadLinkedStaff(String(userId)).then((linkedStaff) => {
      if (!cancelled) setState({ linkedStaff, loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return state;
}
