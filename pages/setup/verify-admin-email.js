import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

async function syncLocalSessionUser() {
  if (typeof window === "undefined") return;

  const token = localStorage.getItem("auth_token");
  if (!token) return;

  const response = await fetch("/api/auth/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) return;

  const data = await response.json();
  if (data?.user) {
    localStorage.setItem("user", JSON.stringify(data.user));
  }
}

export default function VerifyAdminEmailPage() {
  const router = useRouter();
  const { token } = router.query;
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState("Verifying your admin email change...");

  useEffect(() => {
    if (!router.isReady) return;

    if (!token || Array.isArray(token)) {
      setLoading(false);
      setSuccess(false);
      setMessage("This verification link is missing a valid token.");
      return;
    }

    let isCancelled = false;

    async function verifyEmailChange() {
      try {
        const response = await fetch(`/api/setup/verify-admin-email-change?token=${encodeURIComponent(token)}`);
        const data = await response.json();

        if (isCancelled) return;

        if (!response.ok || !data?.success) {
          setSuccess(false);
          setMessage(data?.message || "This verification link is invalid or has expired.");
          return;
        }

        await syncLocalSessionUser();
        if (isCancelled) return;

        setSuccess(true);
        setMessage(data.message || "Admin email updated successfully.");
      } catch (error) {
        if (isCancelled) return;
        setSuccess(false);
        setMessage("Unable to verify this admin email change right now. Please try again later.");
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    verifyEmailChange();

    return () => {
      isCancelled = true;
    };
  }, [router.isReady, token]);

  return (
    <>
      <Head>
        <title>Verify Admin Email Change</title>
      </Head>

      <div className="min-h-screen bg-slate-100 px-4 py-16">
        <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
          <div className={`mb-6 inline-flex h-14 w-14 items-center justify-center rounded-full text-2xl ${success ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {loading ? "…" : success ? "✓" : "!"}
          </div>

          <h1 className="text-3xl font-bold text-slate-900">Verify Admin Email Change</h1>
          <p className="mt-4 text-sm leading-6 text-slate-600">{message}</p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/setup/setup" className="inline-flex items-center rounded-full bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700 transition-colors">
              Return to Setup
            </Link>
            <Link href="/login" className="inline-flex items-center rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              Go to Login
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}