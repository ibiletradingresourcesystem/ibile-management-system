import { useEffect } from "react";
import { useRouter } from "next/router";

export default function AssetsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/setup/assets"); }, [router]);
  return null;
}
