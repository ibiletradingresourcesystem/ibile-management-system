// Centralized theme and styling constants
export const theme = {
  // Color palette
  colors: {
    // Primary
    primary: {
      50: '#eff6ff',
      100: '#dbeafe',
      200: '#bfdbfe',
      300: '#93c5fd',
      400: '#60a5fa',
      500: '#3b82f6',
      600: '#2563eb',
      700: '#1d4ed8',
      800: '#1e40af',
      900: '#1e3a8a',
    },
    // Secondary (Sky/Cyan)
    secondary: {
      50: '#f0f9ff',
      100: '#e0f2fe',
      200: '#bae6fd',
      300: '#7dd3fc',
      400: '#38bdf8',
      500: '#06b6d4',
      600: '#0891b2',
      700: '#0e7490',
      800: '#155e75',
      900: '#164e63',
    },
    // Gray scale
    gray: {
      50: '#f9fafb',
      100: '#f3f4f6',
      200: '#e5e7eb',
      300: '#d1d5db',
      400: '#9ca3af',
      500: '#6b7280',
      600: '#4b5563',
      700: '#374151',
      800: '#1f2937',
      900: '#111827',
    },
    // Semantic colors
    success: {
      50: '#f0fdf4',
      200: '#bbf7d0',
      500: '#10b981',
      600: '#059669',
      700: '#047857',
      900: '#065f46',
    },
    warning: {
      50: '#fffbeb',
      200: '#fcd34d',
      500: '#f59e0b',
      600: '#d97706',
      700: '#b45309',
      900: '#78350f',
    },
    danger: {
      50: '#fef2f2',
      200: '#fecaca',
      500: '#ef4444',
      600: '#dc2626',
      700: '#b91c1c',
      900: '#7f1d1d',
    },
    info: {
      50: '#f0f9ff',
      200: '#bae6fd',
      500: '#0ea5e9',
      600: '#0284c7',
      700: '#0369a1',
      900: '#0c2d6b',
    },
  },

  // Spacing scale
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    '2xl': '3rem',
    '3xl': '4rem',
  },

  // Border radius
  radius: {
    none: '0',
    sm: '0.125rem',
    md: '0.375rem',
    lg: '0.5rem',
    xl: '0.75rem',
    '2xl': '1rem',
    full: '9999px',
  },

  // Shadow
  shadow: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
  },

  // Typography
  typography: {
    // Heading styles
    h1: 'text-4xl font-bold text-gray-900',
    h2: 'text-3xl font-bold text-gray-900',
    h3: 'text-2xl font-semibold text-gray-900',
    h4: 'text-xl font-semibold text-gray-800',
    h5: 'text-lg font-semibold text-gray-800',
    h6: 'text-base font-semibold text-gray-700',
    // Body styles
    body: 'text-base text-gray-700',
    bodySmall: 'text-sm text-gray-600',
    bodySmallerst: 'text-xs text-gray-500',
    // Label styles
    label: 'text-sm font-medium text-gray-700',
    labelSmall: 'text-xs font-medium text-gray-600',
  },

  // Component class names (Tailwind)
  button: {
    base: 'inline-flex items-center justify-center font-medium transition duration-200 ease-in-out rounded-lg',
    sizes: {
      xs: 'px-3 py-1 text-xs',
      sm: 'px-3 py-2 text-sm',
      md: 'px-4 py-2 text-base',
      lg: 'px-6 py-3 text-lg',
    },
    variants: {
      primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300',
      secondary: 'bg-sky-500 text-white hover:bg-sky-600 disabled:bg-gray-300',
      success: 'bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-300',
      danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-300',
      outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
      ghost: 'text-blue-600 hover:bg-blue-50',
    },
  },

  // Input styles
  input: {
    base: 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
    label: 'block text-sm font-medium text-gray-700 mb-2',
    error: 'border-red-500 focus:ring-red-500',
    disabled: 'bg-gray-100 cursor-not-allowed opacity-50',
  },

  // Card styles
  card: {
    base: 'bg-white rounded-lg shadow-md p-6',
    header: 'border-b border-gray-200 pb-4 mb-4',
    footer: 'border-t border-gray-200 pt-4 mt-4',
  },

  // Layout
  layout: {
    container: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8',
    pageBackground: 'min-h-screen bg-gray-50',
    pagePadding: 'p-6 md:p-8',
  },

  // Table styles
  table: {
    header: 'bg-gray-100 border-b border-gray-200',
    headerCell: 'px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider',
    row: 'border-b border-gray-200 hover:bg-gray-50 transition',
    cell: 'px-6 py-4 whitespace-nowrap text-sm text-gray-900',
    cellText: 'text-gray-700',
    cellMuted: 'text-gray-500 text-sm',
  },

  // Badge styles
  badge: {
    base: 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
    gray: 'bg-gray-100 text-gray-800',
  },

  // Alert styles
  alert: {
    base: 'p-4 rounded-lg',
    success: 'bg-green-50 border border-green-200 text-green-700',
    warning: 'bg-yellow-50 border border-yellow-200 text-yellow-700',
    danger: 'bg-red-50 border border-red-200 text-red-700',
    info: 'bg-blue-50 border border-blue-200 text-blue-700',
  },

  // Form group
  formGroup: {
    base: 'mb-6',
    error: 'mt-2 text-xs text-red-600',
    help: 'mt-1 text-xs text-gray-500',
  },
};

export default theme;
