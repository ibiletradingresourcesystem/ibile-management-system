import axios from 'axios';
import { queuePosTransaction } from "@/lib/offlinePosQueue";
import { clearAllAppCaches } from "./clearAllCaches";

export const apiClient = axios.create({
  baseURL: '/',
});

// Add token to requests
apiClient.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
  const method = String(config.method || "get").toLowerCase();
  const url = String(config.url || "");
  const isPosTransactionPost =
    method === "post" && (url === "/api/transactions/transactions" || url.endsWith("/api/transactions/transactions"));

  if (isOffline && isPosTransactionPost) {
    config.adapter = async () => {
      let payload = config.data || {};
      if (typeof config.data === "string") {
        try {
          payload = JSON.parse(config.data || "{}");
        } catch {
          payload = {};
        }
      }
      const queued = queuePosTransaction(payload);
      return {
        data: {
          success: true,
          queued: true,
          message: "Offline: transaction queued for sync",
          transaction: {
            ...payload,
            status: payload?.status || "completed",
            externalId: queued.externalId,
          },
        },
        status: 202,
        statusText: "Accepted",
        headers: {},
        config,
      };
    };
  }

  return config;
}, (error) => {
  return Promise.reject(error);
});

// Handle 401 responses by clearing caches and redirecting to login
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      clearAllAppCaches().catch(() => {});
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        if (!path.includes('/login') && !path.includes('/register')) {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
