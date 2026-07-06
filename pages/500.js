import { useRouter } from "next/router";
import {
  faEnvelope,
  faCircleExclamation,
  faHome,
} from "@fortawesome/free-solid-svg-icons";
import FatalState from "../components/FatalState";

export default function ServerError() {
  const router = useRouter();

  return (
    <FatalState
      theme="serverError"
      code="500"
      icon={faCircleExclamation}
      title="Server Error"
      subtitle="Something went wrong on our end"
      description={
        <>
          We encountered an unexpected error while processing your request. Our
          technical team has been notified and is working to resolve this issue.
        </>
      }
      details={
        <div className="rounded border-l-4 border-red-600 bg-red-50 p-4 text-left">
          <p className="mb-2 text-sm font-semibold text-red-800">What you can do:</p>
          <ul className="space-y-1 text-sm text-red-700">
            <li>• Try refreshing the page</li>
            <li>• Clear your browser cache and cookies</li>
            <li>• Try again in a few moments</li>
            <li>• Contact our support team if the problem persists</li>
          </ul>
        </div>
      }
      secondaryActionLabel="Refresh Page"
      onSecondaryAction={() => router.reload()}
      supportHeading="Next Steps"
      supportCards={[
        {
          title: "Email Support",
          description: "Report this issue to our technical team",
          href: "mailto:support@stmichaelshub.com?subject=Error%20500%20Report",
          linkLabel: "support@stmichaelshub.com",
          icon: faEnvelope,
          tone: "primary",
        },
        {
          title: "Return to Login",
          description:
            "Start a fresh session if the dashboard keeps failing after a refresh",
          href: "/login",
          linkLabel: "Go to login",
          icon: faHome,
          tone: "secondary",
        },
      ]}
      extraSection={
        <div className="-mx-6 mt-12 rounded-b-2xl bg-gray-50 px-6 py-8 sm:-mx-8 sm:px-8">
          <p className="mb-4 text-center text-sm text-gray-600">
            <strong>Still seeing this page?</strong> Share the page URL and the
            approximate time of the error with support.
          </p>
          <p className="text-center text-xs text-gray-500">
            That gives the team a stable breadcrumb without relying on a
            placeholder client-side error ID.
          </p>
        </div>
      }
    />
  );
}
