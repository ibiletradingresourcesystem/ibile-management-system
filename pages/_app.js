import Head from 'next/head';
import '../styles/globals.css';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import Layout from '@/components/Layout';
import { DialogProvider } from '@/components/DialogProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import axios from "axios";
import { fetchAndCacheLogo } from '@/lib/storeLogo';
import {
  handleNumberInputKeyDown,
  handleNumberInputPaste,
  handleNumberInputWheel,
} from '@/lib/inputGuards';
import {
  queuePosTransaction,
  setupOfflinePosQueueSync,
} from "@/lib/offlinePosQueue";

function installGlobalApiFetchWrapper() {
  if (typeof window === "undefined") return;
  if (window.__inventoryFetchWrapped) return;

  const originalFetch = window.fetch.bind(window);
  window.__inventoryOriginalFetch = originalFetch;

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = (
      init.method ||
      (typeof input !== "string" ? input?.method : "GET") ||
      "GET"
    ).toUpperCase();

    const isApiRequest = url.startsWith("/api/");
    const headers = new Headers(
      init.headers || (typeof input !== "string" ? input?.headers : undefined) || {}
    );

    if (isApiRequest && !headers.has("Authorization")) {
      const token = localStorage.getItem("auth_token");
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    const nextInit = { ...init, headers };

    if (
      url === "/api/transactions/transactions" &&
      method === "POST" &&
      typeof navigator !== "undefined" &&
      !navigator.onLine
    ) {
      let payload = {};
      try {
        payload =
          typeof nextInit.body === "string"
            ? JSON.parse(nextInit.body)
            : nextInit.body || {};
      } catch {
        payload = {};
      }

      const queued = queuePosTransaction(payload);
      return new Response(
        JSON.stringify({
          success: true,
          queued: true,
          message: "Offline: transaction queued for sync",
          transaction: {
            ...payload,
            status: payload?.status || "completed",
            externalId: queued.externalId,
          },
        }),
        {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const response = await window.__inventoryOriginalFetch(input, nextInit);

    // Handle 401 from any fetch call (not just apiClient/axios)
    if (isApiRequest && response.status === 401) {
      // Avoid redirect loops if already on `login` or `register`
      const path = window.location.pathname;
      if (!path.includes("/login") && !path.includes("/register")) {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("user");
        window.location.href = "/login";
      }
    }

    return response;
  };

  window.__inventoryFetchWrapped = true;
}

function installAxiosAuthInterceptor() {
  if (typeof window === "undefined") return;
  if (window.__inventoryAxiosWrapped) return;

  axios.interceptors.request.use((config) => {
    const token = localStorage.getItem("auth_token");
    if (token && !config.headers?.Authorization) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error?.response?.status === 401) {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("user");
        const path = window.location.pathname;
        if (!path.includes("/login") && !path.includes("/register")) {
          window.location.href = "/login";
        }
      }
      return Promise.reject(error);
    }
  );

  window.__inventoryAxiosWrapped = true;
}

export default function App({
  Component,
  pageProps,
}) {
  const router = useRouter();
  const showLayout = !router.pathname.includes('/login') && !router.pathname.includes('/register');

  installGlobalApiFetchWrapper();
  installAxiosAuthInterceptor();
  
  // Prime the store logo cache on first load
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!showLayout) return;
    if (!localStorage.getItem("auth_token")) return;

    fetchAndCacheLogo();
  }, [showLayout]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    document.addEventListener("wheel", handleNumberInputWheel, {
      passive: false,
      capture: true,
    });
    document.addEventListener("keydown", handleNumberInputKeyDown, true);
    document.addEventListener("paste", handleNumberInputPaste, true);

    return () => {
      document.removeEventListener("wheel", handleNumberInputWheel, true);
      document.removeEventListener("keydown", handleNumberInputKeyDown, true);
      document.removeEventListener("paste", handleNumberInputPaste, true);
    };
  }, []);

  // Sync queued POS transactions when connectivity returns.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const cleanupSync = setupOfflinePosQueueSync(window.fetch);
    return () => {
      if (cleanupSync) cleanupSync();
    };
  }, []);

  // Make all overflowing tables / containers draggable to scroll horizontally
  useEffect(() => {
    if (typeof window === "undefined") return;

    function initDragScroll() {
      const containers = document.querySelectorAll(".overflow-x-auto, .table-wrapper, .data-table-container");
      containers.forEach((el) => {
        if (el._dragScrollInit) return;
        el._dragScrollInit = true;

        let isDown = false;
        let startX = 0;
        let scrollLeft = 0;

        el.addEventListener("mousedown", (e) => {
          // Don't interfere with clicks on interactive elements
          if (e.target.closest("button, a, input, select, textarea, [role='button']")) return;
          isDown = true;
          el.classList.add("is-dragging");
          startX = e.pageX - el.offsetLeft;
          scrollLeft = el.scrollLeft;
        });

        el.addEventListener("mouseleave", () => {
          isDown = false;
          el.classList.remove("is-dragging");
        });

        el.addEventListener("mouseup", () => {
          isDown = false;
          el.classList.remove("is-dragging");
        });

        el.addEventListener("mousemove", (e) => {
          if (!isDown) return;
          e.preventDefault();
          const x = e.pageX - el.offsetLeft;
          const walk = (x - startX) * 1.5;
          el.scrollLeft = scrollLeft - walk;
        });
      });
    }

    // Initialize on load and re-init on route changes
    initDragScroll();
    const observer = new MutationObserver(() => initDragScroll());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);
  
  return (
    <DialogProvider>
      <>
        <Head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="description" content="Generated by create next app" />
          <meta name="robots" content="noindex" />
          <meta name="googlebot" content="noindex" />
          <meta name="google" content="notranslate" />
          <meta name="theme-color" content="#000000" />
          <link rel="apple-touch-icon" sizes="180x180" href="/favicon/apple-touch-icon.png" />
          <link rel="icon" type="image/png" sizes="32x32" href="/favicon/favicon-32x32.png" />
          <link rel="icon" type="image/png" sizes="16x16" href="/favicon/favicon-16x16.png" />
          <meta name="msapplication-TileColor" content="#000000" />
          <title>St Michael’s Invetory app</title>
          <meta name="description" content="Best products at the best prices!" />
          <link rel="icon" href="/favicon/favicon.ico" />
        </Head>
        
        {showLayout ? (
          <ThemeProvider>
            <Layout>
              <Component {...pageProps} />
            </Layout>
          </ThemeProvider>
        ) : (
          <Component {...pageProps} />
        )}
      </>
    </DialogProvider>
  );
}
