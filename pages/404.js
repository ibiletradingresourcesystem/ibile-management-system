import { useRouter } from "next/router";
import {
  faEnvelope,
  faExclamationCircle,
  faHome,
} from "@fortawesome/free-solid-svg-icons";
import FatalState, { FatalStateBulletList } from "../components/FatalState";

export default function NotFound() {
  const router = useRouter();
  const currentYear = new Date().getFullYear();

  return (
    <FatalState
      theme="notFound"
      code="404"
      icon={faExclamationCircle}
      title="Page Not Found"
      subtitle="We couldn't find the page you're looking for"
      description={
        <>
          The page you&apos;re trying to access doesn't exist or may have been moved.
          This could be due to:
        </>
      }
      details={
        <FatalStateBulletList
          theme="notFound"
          items={[
            "An incorrect or outdated URL",
            "A page that has been removed or archived",
            "Insufficient permissions to access this resource",
          ]}
        />
      }
      secondaryActionLabel="Go Back"
      onSecondaryAction={() => router.back()}
      supportHeading="Need Help?"
      supportCards={[
        {
          title: "Email Support",
          description: "Reach out to our support team for assistance",
          href: "mailto:support@stmichaelshub.com?subject=Page%20Not%20Found",
          linkLabel: "support@stmichaelshub.com",
          icon: faEnvelope,
          tone: "primary",
        },
        {
          title: "Return to Login",
          description:
            "Start a new session and navigate back into the app from a known entry point",
          href: "/login",
          linkLabel: "Go to login",
          icon: faHome,
          tone: "secondary",
        },
      ]}
      quickLinks={[
        { label: "Products", href: "/manage/products" },
        { label: "Customers", href: "/manage/customers" },
        { label: "Orders", href: "/manage/orders" },
        { label: "Reports", href: "/reporting/reporting" },
        { label: "Settings", href: "/setup/receipts" },
      ]}
      footer={
        <p className="text-center text-xs text-gray-500 sm:text-sm">
          © {currentYear} St Michaels Hub. | Error Code: 404
        </p>
      }
    />
  );
}
