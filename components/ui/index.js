// Centralized imports
import { theme } from "@/styles/theme";
import Loader from "@/components/Loader";

// components/ui/Button.js
export function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  className = "",
  ...props
}) {
  const baseClass = theme.button.base;
  const variantClass = theme.button.variants[variant];
  const sizeClass = theme.button.sizes[size];
  const disabledClass = disabled ? "opacity-50 cursor-not-allowed" : "";

  return (
    <button
      className={`${baseClass} ${variantClass} ${sizeClass} ${disabledClass} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}

// components/ui/Input.js
export function Input({
  label,
  error,
  disabled = false,
  className = "",
  ...props
}) {
  const baseClass = theme.input.base;
  const errorClass = error ? theme.input.error : "";
  const disabledClass = disabled ? theme.input.disabled : "";

  return (
    <div className={theme.formGroup.base}>
      {label && <label className={theme.input.label}>{label}</label>}
      <input
        className={`${baseClass} ${errorClass} ${disabledClass} ${className}`}
        disabled={disabled}
        {...props}
      />
      {error && <p className={theme.formGroup.error}>{error}</p>}
    </div>
  );
}

// components/ui/Card.js
export function Card({ children, className = "" }) {
  return <div className={`${theme.card.base} ${className}`}>{children}</div>;
}

export function CardHeader({ children, className = "" }) {
  return <div className={`${theme.card.header} ${className}`}>{children}</div>;
}

export function CardFooter({ children, className = "" }) {
  return <div className={`${theme.card.footer} ${className}`}>{children}</div>;
}

// components/ui/Badge.js
export function Badge({ children, variant = "gray", className = "" }) {
  const variantClass = theme.badge[variant];
  return (
    <span className={`${theme.badge.base} ${variantClass} ${className}`}>
      {children}
    </span>
  );
}

// components/ui/Alert.js
export function Alert({ children, type = "info", className = "" }) {
  const typeClass = theme.alert[type];
  return (
    <div className={`${theme.alert.base} ${typeClass} ${className}`}>
      {children}
    </div>
  );
}

// components/ui/Select.js
export function Select({
  label,
  options,
  value,
  onChange,
  error,
  disabled = false,
  className = "",
  ...props
}) {
  return (
    <div className={theme.formGroup.base}>
      {label && <label className={theme.input.label}>{label}</label>}
      <select
        className={`${theme.input.base} ${error ? theme.input.error : ""} ${
          disabled ? theme.input.disabled : ""
        } ${className}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        {...props}
      >
        <option value="">* Select {label}</option>
        {options.map((opt) => (
          <option key={opt._id} value={opt._id}>
            {opt.name}
          </option>
        ))}
      </select>
      {error && <p className={theme.formGroup.error}>{error}</p>}
    </div>
  );
}

// components/ui/Table.js
export function Table({ children, className = "" }) {
  return (
    <div className="overflow-x-auto bg-white rounded-lg shadow">
      <table className={`min-w-full divide-y divide-gray-200 ${className}`}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children, className = "" }) {
  return (
    <thead className={`${theme.table.header} ${className}`}>
      {children}
    </thead>
  );
}

export function TableHeaderCell({ children, className = "" }) {
  return (
    <th className={`${theme.table.headerCell} ${className}`}>
      {children}
    </th>
  );
}

export function TableBody({ children, className = "" }) {
  return <tbody className={className}>{children}</tbody>;
}

export function TableRow({ children, className = "" }) {
  return (
    <tr className={`${theme.table.row} ${className}`}>
      {children}
    </tr>
  );
}

export function TableCell({ children, muted = false, className = "" }) {
  const textClass = muted ? theme.table.cellMuted : theme.table.cellText;
  return (
    <td className={`${theme.table.cell} ${textClass} ${className}`}>
      {children}
    </td>
  );
}

// components/ui/StatCard.js
export function StatCard({ label, value, highlight = false, className = "" }) {
  const bgColor = highlight ? "bg-red-50 border-red-200" : "bg-white border-gray-200";
  const textColor = highlight ? "text-red-700" : "text-gray-600";

  return (
    <div
      className={`${bgColor} border rounded-lg p-6 shadow-md transition hover:shadow-lg ${className}`}
    >
      <p className={`text-sm font-medium ${textColor} mb-2`}>{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

// components/ui/Loader.js - Re-export unified Loader with progress bar support
// All pages now use the same Loader from @/components/Loader
export { Loader };

// components/ui/PageHeader.js
export function PageHeader({ title, description, className = "" }) {
  return (
    <div className={`mb-10 ${className}`}>
      <h1 className={theme.typography.h1}>{title}</h1>
      {description && <p className="text-gray-600 mt-2">{description}</p>}
    </div>
  );
}

// components/ui/Section.js
export function Section({ children, className = "" }) {
  return <div className={`mb-10 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, className = "" }) {
  return <h2 className={`${theme.typography.h3} mb-4 ${className}`}>{children}</h2>;
}

export default {
  Button,
  Input,
  Card,
  CardHeader,
  CardFooter,
  Badge,
  Alert,
  Select,
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  StatCard,
  Loader,
  PageHeader,
  Section,
  SectionTitle,
};
