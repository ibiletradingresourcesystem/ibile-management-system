/**
 * Superseded by the Profit & Loss tab on /accounting/reports, which runs off
 * the same API. Kept as a redirect so old bookmarks still land somewhere real.
 */
import { useEffect } from "react";
import { useRouter } from "next/router";

export default function ProfitLossRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/accounting/reports?tab=profit-loss");
  }, [router]);
  return null;
}
