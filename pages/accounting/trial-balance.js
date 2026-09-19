/**
 * Superseded by the Trial Balance tab on /accounting/reports, which runs off
 * the same API. Kept as a redirect so old bookmarks still land somewhere real.
 */
import { useEffect } from "react";
import { useRouter } from "next/router";

export default function TrialBalanceRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/accounting/reports?tab=trial-balance");
  }, [router]);
  return null;
}
