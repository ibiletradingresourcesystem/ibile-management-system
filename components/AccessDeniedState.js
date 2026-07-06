import { Shield } from "lucide-react";

export default function AccessDeniedState({
  title = "Access Denied",
  message = "You don't have permission to access this page.",
  actionLabel = "Go to Available Page",
  onAction,
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <Shield className="mx-auto mb-4 text-red-400" size={48} />
        <h2 className="text-xl font-bold text-gray-700">{title}</h2>
        <p className="text-gray-500 mt-2">{message}</p>
        {onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}