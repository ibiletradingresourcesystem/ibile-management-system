// Global styling utilities and CSS classes
// Add this to your globals.css or use as utility classes

export const styleGuide = {
  // Page Containers
  pageContainer: "min-h-screen bg-gray-50 p-6",
  contentWrapper: "max-w-7xl mx-auto",
  
  // Headers
  pageHeader: "flex justify-between items-center mb-8",
  pageTitle: "text-3xl font-bold text-gray-900",
  pageSubtitle: "text-lg text-gray-600 mt-2",
  
  // Cards & Boxes
  card: "bg-white rounded-lg shadow-lg p-6",
  cardHeader: "mb-4",
  cardTitle: "text-xl font-bold text-gray-900 mb-2",
  cardSubtitle: "text-sm text-gray-600",
  
  // Sections
  section: "bg-white rounded-lg shadow-lg p-6 mb-8",
  sectionHeader: "flex justify-between items-center mb-6",
  sectionTitle: "text-2xl font-bold text-gray-900",
  sectionDescription: "text-gray-600 text-sm",
  
  // Forms
  formContainer: "space-y-4",
  formField: "flex flex-col",
  formLabel: "block text-sm font-medium text-gray-700 mb-1",
  formInput: "border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 w-full",
  formSelect: "border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 w-full",
  formTextarea: "border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 w-full font-mono text-sm",
  
  // Buttons
  btnPrimary: "bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-6 rounded transition",
  btnPrimaryLarge: "bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-8 rounded transition",
  btnSecondary: "bg-gray-200 hover:bg-gray-300 text-gray-900 font-bold py-2 px-6 rounded transition",
  btnDanger: "bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded transition",
  btnSuccess: "bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded transition",
  btnOutline: "border-2 border-cyan-600 text-cyan-600 hover:bg-cyan-50 font-bold py-2 px-6 rounded transition",
  btnLink: "text-cyan-600 hover:text-cyan-700 font-bold underline cursor-pointer",
  
  // Tables
  tableContainer: "overflow-x-auto",
  table: "w-full",
  tableHead: "bg-gradient-to-r from-cyan-600 to-cyan-700 text-white sticky top-0",
  tableHeadCell: "px-4 py-3 text-left font-bold text-white",
  tableBody: "",
  tableRow: "border-b border-gray-200 hover:bg-gray-50 transition",
  tableCell: "px-4 py-3",
  tableRowAlt: "bg-gray-50",
  
  // Messages & Alerts
  alertSuccess: "bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-6",
  alertError: "bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-6",
  alertWarning: "bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg mb-6",
  alertInfo: "bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg mb-6",
  
  // Badges & Tags
  badge: "inline-block rounded-full font-semibold text-xs px-3 py-1",
  badgeSuccess: "bg-green-100 text-green-800",
  badgeError: "bg-red-100 text-red-800",
  badgeWarning: "bg-amber-100 text-amber-800",
  badgeInfo: "bg-blue-100 text-blue-800",
  
  // Loading States
  loaderContainer: "min-h-screen bg-gray-50 flex items-center justify-center",
  loaderSpinner: "inline-block animate-spin h-12 w-12 text-cyan-600",
  loaderText: "mt-4 text-gray-600 font-medium",
  
  // Modals
  modalOverlay: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50",
  modalContent: "bg-white rounded-lg p-6 max-w-md w-full shadow-xl",
  modalHeader: "text-2xl font-bold text-gray-900 mb-4",
  modalBody: "space-y-4",
  modalFooter: "flex gap-4 mt-6",
  
  // Breadcrumbs
  breadcrumb: "text-sm text-gray-600 mb-6",
  breadcrumbLink: "text-cyan-600 hover:text-cyan-700 cursor-pointer",
  
  // Grid Layouts
  gridTwoCols: "grid grid-cols-1 lg:grid-cols-2 gap-6",
  gridThreeCols: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6",
  gridFourCols: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6",
  
  // Stat Cards
  statCard: "bg-white rounded-lg p-6 shadow-lg border-l-4 border-cyan-600",
  statLabel: "text-sm text-gray-600 font-medium",
  statValue: "text-3xl font-bold text-gray-900 mt-2",
  statChange: "text-sm mt-2",
  statChangeUp: "text-green-600",
  statChangeDown: "text-red-600",
};
