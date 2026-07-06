"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import { apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";

const STATUS_OPTIONS = ["requested", "confirmed", "cancelled", "completed"];

const NOTICE_CLASS = {
  success: "bg-green-50 border-green-200 text-green-700",
  warning: "bg-amber-50 border-amber-200 text-amber-700",
  error: "bg-red-50 border-red-200 text-red-700",
};

const STATUS_CLASS = {
  requested: "bg-cyan-100 text-cyan-700",
  confirmed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
  completed: "bg-slate-200 text-slate-700",
};

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function formatDate(value) {
  if (!value) {
    return "Not available";
  }

  const parsedValue = new Date(value);
  if (Number.isNaN(parsedValue.getTime())) {
    return String(value);
  }

  return parsedValue.toISOString().slice(0, 10);
}

function buildReservationDetail(reservation) {
  if (reservation.kind === "stay") {
    return {
      label: reservation.roomName || "Any available room",
      meta: `${formatDate(reservation.checkInDate)} to ${formatDate(reservation.checkOutDate)} · ${reservation.nights} night${reservation.nights === 1 ? "" : "s"}`,
      note: `${reservation.adults} adult${reservation.adults === 1 ? "" : "s"}${reservation.children ? `, ${reservation.children} child${reservation.children === 1 ? "" : "ren"}` : ""}`,
    };
  }

  return {
    label: `${formatDate(reservation.reservationDate)} at ${reservation.reservationTime}`,
    meta: `Party of ${reservation.partySize}${reservation.areaPreference ? ` · ${reservation.areaPreference}` : ""}`,
    note: reservation.occasion || "Lounge reservation",
  };
}

function getStayRevenueAmount(reservation) {
  const totalAmount = Number(reservation?.totalAmount || 0);
  if (Number.isFinite(totalAmount) && totalAmount > 0) {
    return totalAmount;
  }

  const roomRate = Number(reservation?.roomRate || 0);
  const nights = Number(reservation?.nights || 0);
  const derivedAmount = roomRate * nights;

  return Number.isFinite(derivedAmount) && derivedAmount > 0 ? derivedAmount : 0;
}

function getRevenueBadgeState(reservation) {
  if (reservation.kind !== "stay") {
    return {
      label: "N/A",
      detail: "Tracked only for stay bookings",
      badgeClass: "bg-slate-100 text-slate-600",
    };
  }

  const totalAmount = getStayRevenueAmount(reservation);

  if (reservation.status === "completed" && reservation.transactionId) {
    return {
      label: "Recorded",
      detail: `${formatCurrency(totalAmount)} completed${reservation.completedAt ? ` · ${formatDate(reservation.completedAt)}` : ""}`,
      badgeClass: "bg-emerald-100 text-emerald-700",
    };
  }

  if (reservation.status === "completed") {
    return {
      label: totalAmount > 0 ? "Missing transaction" : "Missing rate",
      detail:
        totalAmount > 0
          ? `${formatCurrency(totalAmount)} expected but not linked`
          : "Link this stay to a priced room before completing",
      badgeClass: "bg-amber-100 text-amber-700",
    };
  }

  if (reservation.status === "cancelled") {
    return {
      label: "Not recorded",
      detail: "Cancelled stays do not count as completed revenue",
      badgeClass: "bg-slate-100 text-slate-600",
    };
  }

  if (totalAmount > 0) {
    return {
      label: "Pending completion",
      detail: `${formatCurrency(totalAmount)} will be recorded when completed`,
      badgeClass: "bg-sky-100 text-sky-700",
    };
  }

  return {
    label: "Needs room rate",
    detail: "Link this stay to a priced room product first",
    badgeClass: "bg-rose-100 text-rose-700",
  };
}

function SummaryCard({ title, value, tone = "text-slate-900" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">{title}</p>
      <p className={`mt-3 text-3xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

export default function HotelReservationsPage() {
  const [reservations, setReservations] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    stay: 0,
    table: 0,
    byStatus: {
      requested: 0,
      confirmed: 0,
      cancelled: 0,
      completed: 0,
    },
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [busyReservationId, setBusyReservationId] = useState(null);
  const [message, setMessage] = useState(null);
  const [draftStatusById, setDraftStatusById] = useState({});

  const entriesPerPage = 12;

  useEffect(() => {
    if (!message?.text) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setMessage(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, typeFilter]);

  async function fetchReservations() {
    setLoading(true);

    try {
      const { data } = await apiClient.get("/api/hotel/reservations", {
        params: {
          page: currentPage,
          limit: entriesPerPage,
          search: normalizeString(search),
          status: statusFilter,
          kind: typeFilter,
        },
      });

      setReservations(data.reservations || []);
      setSummary(data.summary || summary);
      setTotalPages(Math.max(1, data.totalPages || 1));
      setDraftStatusById(
        Object.fromEntries((data.reservations || []).map((reservation) => [reservation._id, reservation.status]))
      );
    } catch (error) {
      console.error("Failed to load hotel reservations:", error);
      setReservations([]);
      setSummary({
        total: 0,
        stay: 0,
        table: 0,
        byStatus: {
          requested: 0,
          confirmed: 0,
          cancelled: 0,
          completed: 0,
        },
      });
      setTotalPages(1);
      setMessage({
        type: "error",
        title: "Couldn't load hotel reservations",
        text: "Refresh the page and try again.",
      });
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }

  useEffect(() => {
    fetchReservations();
  }, [currentPage, search, statusFilter, typeFilter]);

  async function handleStatusSave(reservation) {
    const nextStatus = draftStatusById[reservation._id] || reservation.status;
    if (!nextStatus || nextStatus === reservation.status) {
      return;
    }

    setBusyReservationId(reservation._id);
    setMessage(null);

    try {
      const { data: updatedReservation } = await apiClient.put(`/api/hotel/reservations/${reservation._id}`, {
        kind: reservation.kind,
        status: nextStatus,
      });

      const emailState = updatedReservation?.emailState || "skipped";
      const transactionState = updatedReservation?.transactionState || "skipped";
      const transactionTotal = Number(updatedReservation?.transactionTotal || 0);
      let transactionMessage = "";

      if (reservation.kind === "stay" && nextStatus === "completed") {
        if (transactionState === "created" || transactionState === "updated") {
          transactionMessage = ` Room revenue of ${formatCurrency(transactionTotal)} was recorded as a completed transaction.`;
        }
      } else if (reservation.kind === "stay" && transactionState === "removed") {
        transactionMessage = " The completed room transaction was removed because this stay is no longer marked as completed.";
      }

      setMessage({
        type: emailState === "failed" ? "warning" : "success",
        title: emailState === "failed" ? "Reservation updated, email not sent" : "Reservation updated",
        text:
          emailState === "sent"
            ? `${reservation.reference} is now marked as ${nextStatus}. A guest email was sent.${transactionMessage}`
            : emailState === "failed"
              ? `${reservation.reference} is now marked as ${nextStatus}, but the guest email could not be sent.${transactionMessage}`
              : `${reservation.reference} is now marked as ${nextStatus}.${transactionMessage}`,
      });
      await fetchReservations();
    } catch (error) {
      console.error("Failed to update hotel reservation:", error);
      setMessage({
        type: "error",
        title: "Update failed",
        text:
          error?.response?.data?.error ||
          error?.response?.data?.message ||
          "We couldn't update this reservation right now.",
      });
    } finally {
      setBusyReservationId(null);
    }
  }

  const pageTitle = useMemo(() => {
    if (typeFilter === "stay") {
      return "Hotel stay requests";
    }

    if (typeFilter === "table") {
      return "Lounge table reservations";
    }

    return "Hotel reservations";
  }, [typeFilter]);

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content space-y-6">
          <div className="page-header flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="page-title">{pageTitle}</h1>
              <p className="mt-2 text-sm text-slate-600">
                Manage direct stay requests and lounge table reservations from the hotel-facing site.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href="/manage/products?location=Hotel" className="btn-action-secondary w-full text-center sm:w-auto">
                View hotel inventory
              </Link>
              <Link href="/manage/products" className="btn-action-primary w-full text-center sm:w-auto">
                All products
              </Link>
            </div>
          </div>

          {message ? (
            <div className={`rounded-2xl border px-4 py-3 text-sm ${NOTICE_CLASS[message.type] || NOTICE_CLASS.error}`}>
              <p className="font-semibold">{message.title}</p>
              <p className="mt-1">{message.text}</p>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <SummaryCard title="Total" value={summary.total} />
            <SummaryCard title="Stay Requests" value={summary.stay} tone="text-sky-700" />
            <SummaryCard title="Table Requests" value={summary.table} tone="text-fuchsia-700" />
            <SummaryCard title="Requested" value={summary.byStatus.requested} tone="text-cyan-700" />
            <SummaryCard title="Confirmed" value={summary.byStatus.confirmed} tone="text-emerald-700" />
            <SummaryCard title="Cancelled / Completed" value={summary.byStatus.cancelled + summary.byStatus.completed} tone="text-slate-700" />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr_0.7fr]">
              <div className="search-input-wrapper max-w-none">
                <Search className="search-input-icon" />
                <input
                  type="text"
                  placeholder="Search by reference, guest, room, email, phone, or occasion"
                  className="search-input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>

              <select
                className="form-select"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
              >
                <option value="all">All reservation types</option>
                <option value="stay">Stay requests</option>
                <option value="table">Table reservations</option>
              </select>

              <select
                className="form-select"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">All statuses</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {initialLoad ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <Loader size="md" text="Loading hotel reservations..." />
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Reference</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Guest</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Reservation</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Submitted</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Status</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Revenue</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Update</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center">
                          <Loader size="sm" text="Refreshing reservations..." />
                        </td>
                      </tr>
                    ) : reservations.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                          No hotel reservations matched the current filters.
                        </td>
                      </tr>
                    ) : (
                      reservations.map((reservation) => {
                        const detail = buildReservationDetail(reservation);
                        const revenueState = getRevenueBadgeState(reservation);
                        const isBusy = busyReservationId === reservation._id;
                        const nextStatus = draftStatusById[reservation._id] || reservation.status;

                        return (
                          <tr key={`${reservation.kind}-${reservation._id}`} className="align-top">
                            <td className="px-4 py-4">
                              <div className="font-semibold text-slate-900">{reservation.reference}</div>
                              <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${reservation.kind === "stay" ? "bg-sky-100 text-sky-700" : "bg-fuchsia-100 text-fuchsia-700"}`}>
                                {reservation.kind === "stay" ? "Stay" : "Table"}
                              </span>
                            </td>
                            <td className="px-4 py-4">
                              <p className="font-semibold text-slate-900">{reservation.guestName}</p>
                              <p className="mt-1 text-slate-600">{reservation.email}</p>
                              <p className="mt-1 text-slate-500">{reservation.phone}</p>
                            </td>
                            <td className="px-4 py-4">
                              <p className="font-semibold text-slate-900">{detail.label}</p>
                              <p className="mt-1 text-slate-600">{detail.meta}</p>
                              <p className="mt-1 text-slate-500">{detail.note}</p>
                              {reservation.preferredArrivalTime ? (
                                <p className="mt-2 text-xs text-slate-500">Arrival: {reservation.preferredArrivalTime}</p>
                              ) : null}
                              {reservation.specialRequests ? (
                                <p className="mt-2 text-xs text-slate-500">Notes: {reservation.specialRequests}</p>
                              ) : null}
                            </td>
                            <td className="px-4 py-4 text-slate-600">{formatDate(reservation.createdAt)}</td>
                            <td className="px-4 py-4">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${STATUS_CLASS[reservation.status] || STATUS_CLASS.requested}`}>
                                {reservation.status}
                              </span>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex min-w-[210px] flex-col gap-2">
                                <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${revenueState.badgeClass}`}>
                                  {revenueState.label}
                                </span>
                                <p className="text-xs text-slate-500">{revenueState.detail}</p>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex min-w-[190px] flex-col gap-2">
                                <select
                                  className="form-select"
                                  value={nextStatus}
                                  onChange={(event) =>
                                    setDraftStatusById((currentValue) => ({
                                      ...currentValue,
                                      [reservation._id]: event.target.value,
                                    }))
                                  }
                                  disabled={isBusy}
                                >
                                  {STATUS_OPTIONS.map((status) => (
                                    <option key={status} value={status}>
                                      {status}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => handleStatusSave(reservation)}
                                  disabled={isBusy || nextStatus === reservation.status}
                                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                                >
                                  {isBusy ? "Saving..." : "Save status"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">Page {currentPage} of {totalPages}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((currentValue) => Math.max(1, currentValue - 1))}
                    disabled={currentPage <= 1 || loading}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((currentValue) => Math.min(totalPages, currentValue + 1))}
                    disabled={currentPage >= totalPages || loading}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}