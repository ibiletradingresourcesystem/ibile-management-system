import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Info, MessageSquare, X } from "lucide-react";
import { registerDialogApi } from "@/lib/dialogs";

const DialogContext = createContext(null);
const DEFAULT_TOAST_DURATION = 4000;

const TONE_STYLES = {
  danger: {
    icon: AlertTriangle,
    iconWrap: "bg-red-100 text-red-600",
    confirm: "bg-red-600 hover:bg-red-700 text-white",
    toast: "border-red-200 bg-white",
    toastIcon: "bg-red-100 text-red-600",
    toastAccent: "bg-red-500",
  },
  warning: {
    icon: AlertTriangle,
    iconWrap: "bg-amber-100 text-amber-600",
    confirm: "bg-amber-500 hover:bg-amber-600 text-white",
    toast: "border-amber-200 bg-white",
    toastIcon: "bg-amber-100 text-amber-600",
    toastAccent: "bg-amber-500",
  },
  success: {
    icon: Info,
    iconWrap: "bg-green-100 text-green-600",
    confirm: "bg-green-600 hover:bg-green-700 text-white",
    toast: "border-green-200 bg-white",
    toastIcon: "bg-green-100 text-green-600",
    toastAccent: "bg-green-500",
  },
  info: {
    icon: Info,
    iconWrap: "theme-badge-soft",
    confirm: "bg-sky-600 hover:bg-sky-700 text-white",
    toast: "theme-border-soft bg-white",
    toastIcon: "theme-badge-soft",
    toastAccent: "theme-accent-bg",
  },
  neutral: {
    icon: MessageSquare,
    iconWrap: "bg-gray-100 text-gray-600",
    confirm: "bg-gray-900 hover:bg-gray-800 text-white",
    toast: "border-gray-200 bg-white",
    toastIcon: "bg-gray-100 text-gray-600",
    toastAccent: "bg-gray-500",
  },
};

function normalizeOptions(type, options) {
  if (typeof options === "string") {
    return {
      type,
      title: type === "prompt" ? "Input required" : type === "confirm" ? "Please confirm" : "Notice",
      message: options,
    };
  }

  return {
    type,
    title: type === "prompt" ? "Input required" : type === "confirm" ? "Please confirm" : "Notice",
    message: "",
    tone: type === "alert" ? "info" : "neutral",
    confirmLabel: type === "prompt" ? "Continue" : "OK",
    cancelLabel: "Cancel",
    required: false,
    placeholder: "",
    defaultValue: "",
    details: [],
    ...options,
  };
}

function normalizeToastOptions(options) {
  if (typeof options === "string") {
    return {
      title: "Notice",
      message: options,
      tone: "info",
      duration: DEFAULT_TOAST_DURATION,
      dismissible: true,
    };
  }

  return {
    title: "Notice",
    message: "",
    tone: "info",
    duration: DEFAULT_TOAST_DURATION,
    dismissible: true,
    details: [],
    ...options,
  };
}

function PromptField({ dialog, value, onChange, error }) {
  if (dialog.type !== "prompt") return null;

  const inputClassName = `mt-3 w-full rounded-xl border px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 ${
    error ? "border-red-300" : "border-gray-300"
  }`;

  return (
    <div>
      {dialog.label && <label className="mt-3 block text-sm font-medium text-gray-700">{dialog.label}</label>}
      {dialog.multiline ? (
        <textarea
          autoFocus
          rows={dialog.rows || 4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={dialog.placeholder}
          className={`${inputClassName} resize-none`}
        />
      ) : (
        <input
          autoFocus
          type={dialog.inputType || "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={dialog.placeholder}
          className={inputClassName}
        />
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function DetailsList({ details }) {
  if (!Array.isArray(details) || details.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="space-y-2">
        {details.map((detail, index) => {
          const item = typeof detail === "string" ? { label: detail, value: "" } : detail;
          return (
            <div key={`${item.label}-${index}`} className="flex items-center justify-between gap-3 text-sm text-gray-700">
              <span>{item.label}</span>
              {item.value !== undefined && item.value !== "" && (
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-gray-800 shadow-sm">
                  {item.value}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActiveDialog({ dialog, onResolve }) {
  const [value, setValue] = useState(dialog?.defaultValue || "");
  const [error, setError] = useState("");
  const panelRef = useRef(null);

  useEffect(() => {
    setValue(dialog?.defaultValue || "");
    setError("");
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onResolve(dialog.type === "alert" ? undefined : null);
      }

      if (event.key === "Enter" && dialog.type !== "prompt") {
        event.preventDefault();
        onResolve(dialog.type === "confirm" ? true : undefined);
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dialog, onResolve]);

  useEffect(() => {
    if (!dialog || dialog.type !== "prompt") return undefined;

    const currentPanel = panelRef.current;
    if (!currentPanel) return undefined;

    const field = currentPanel.querySelector("input, textarea");
    field?.focus();
    field?.select?.();
    return undefined;
  }, [dialog]);

  if (!dialog) return null;

  const tone = TONE_STYLES[dialog.tone] || TONE_STYLES.neutral;
  const Icon = tone.icon;

  const handleConfirm = () => {
    if (dialog.type !== "prompt") {
      onResolve(dialog.type === "confirm" ? true : undefined);
      return;
    }

    const nextValue = value.trim();
    if (dialog.required && !nextValue) {
      setError(dialog.requiredMessage || "This field is required.");
      return;
    }

    onResolve(dialog.trim === false ? value : nextValue);
  };

  const handleBackdropClick = () => {
    onResolve(dialog.type === "alert" ? undefined : null);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm" onClick={handleBackdropClick}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div className="flex items-start gap-4">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tone.iconWrap}`}>
              <Icon size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{dialog.title}</h2>
              {dialog.message && <p className="mt-1 text-sm leading-6 text-gray-600">{dialog.message}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={handleBackdropClick}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5">
          <DetailsList details={dialog.details} />
          <PromptField dialog={dialog} value={value} onChange={setValue} error={error} />
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-gray-100 px-6 py-4 sm:flex-row sm:justify-end">
          {dialog.type !== "alert" && (
            <button
              type="button"
              onClick={() => onResolve(null)}
              className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              {dialog.cancelLabel || "Cancel"}
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            className={`rounded-xl px-4 py-2.5 text-sm font-medium transition ${tone.confirm}`}
          >
            {dialog.confirmLabel || (dialog.type === "prompt" ? "Continue" : "OK")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToastViewport({ toasts, onDismiss }) {
  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[110] flex w-[min(100%,24rem)] flex-col gap-3">
      {toasts.map((toast) => {
        const tone = TONE_STYLES[toast.tone] || TONE_STYLES.info;
        const Icon = tone.icon;

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto overflow-hidden rounded-2xl border shadow-xl ${tone.toast}`}
            role="status"
            aria-live="polite"
          >
            <div className={`h-1 w-full ${tone.toastAccent}`} />
            <div className="flex items-start gap-3 p-4">
              <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone.toastIcon}`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">{toast.title}</p>
                {toast.message && <p className="mt-1 text-sm leading-5 text-gray-600">{toast.message}</p>}
                {Array.isArray(toast.details) && toast.details.length > 0 && (
                  <div className="mt-2 space-y-1 text-xs text-gray-500">
                    {toast.details.map((detail, index) => {
                      const item = typeof detail === "string" ? { label: detail, value: "" } : detail;
                      return (
                        <div key={`${toast.id}-detail-${index}`} className="flex items-center justify-between gap-2">
                          <span>{item.label}</span>
                          {item.value !== undefined && item.value !== "" && <span className="font-semibold text-gray-700">{item.value}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {toast.dismissible !== false && (
                <button
                  type="button"
                  onClick={() => onDismiss(toast.id)}
                  className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                  aria-label="Dismiss notification"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);
  const resolverRef = useRef(null);
  const toastTimeoutsRef = useRef(new Map());

  const dismissToast = useCallback((toastId) => {
    const timeoutId = toastTimeoutsRef.current.get(toastId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      toastTimeoutsRef.current.delete(toastId);
    }

    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  const settleDialog = useCallback((result) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    resolve?.(result);
  }, []);

  const openDialog = useCallback((type, options) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ...normalizeOptions(type, options),
      });
    });
  }, []);

  const toast = useCallback((options) => {
    const nextToast = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...normalizeToastOptions(options),
    };

    setToasts((current) => [...current, nextToast]);

    if (nextToast.duration !== 0) {
      const timeoutId = setTimeout(() => {
        dismissToast(nextToast.id);
      }, nextToast.duration || DEFAULT_TOAST_DURATION);
      toastTimeoutsRef.current.set(nextToast.id, timeoutId);
    }

    return Promise.resolve(nextToast.id);
  }, [dismissToast]);

  const alert = useCallback((options) => {
    if (options && typeof options === "object" && options.modal) {
      return openDialog("alert", options);
    }

    return toast(options);
  }, [openDialog, toast]);

  const confirm = useCallback((options) => openDialog("confirm", options), [openDialog]);
  const prompt = useCallback((options) => openDialog("prompt", options), [openDialog]);

  useEffect(() => {
    return () => {
      for (const timeoutId of toastTimeoutsRef.current.values()) {
        clearTimeout(timeoutId);
      }
      toastTimeoutsRef.current.clear();
    };
  }, []);

  const value = useMemo(() => ({ confirm, alert, prompt, toast }), [alert, confirm, prompt, toast]);

  useEffect(() => {
    registerDialogApi(value);

    return () => {
      registerDialogApi(null);
    };
  }, [value]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      <ActiveDialog dialog={dialog} onResolve={settleDialog} />
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("useDialog must be used within a DialogProvider");
  }
  return context;
}