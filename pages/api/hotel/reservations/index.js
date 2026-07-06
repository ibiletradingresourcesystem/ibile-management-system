import mongoose from "mongoose";
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import HotelBooking from "@/models/HotelBooking";
import HotelTableReservation from "@/models/HotelTableReservation";

const STATUS_OPTIONS = ["requested", "confirmed", "cancelled", "completed"];

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInteger(value, fallbackValue) {
  const parsedValue = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
}

function serializeStayReservation(reservation) {
  return {
    _id: String(reservation._id),
    kind: "stay",
    reference: String(reservation._id),
    guestName: reservation.guestName,
    email: reservation.email,
    phone: reservation.phone,
    status: reservation.status,
    roomName: reservation.roomName || "Any available room",
    checkInDate: reservation.checkInDate,
    checkOutDate: reservation.checkOutDate,
    nights: reservation.nights,
    roomRate: reservation.roomRate || 0,
    totalAmount: reservation.totalAmount || 0,
    adults: reservation.adults,
    children: reservation.children,
    preferredArrivalTime: reservation.preferredArrivalTime,
    specialRequests: reservation.specialRequests,
    completedAt: reservation.completedAt,
    transactionId: reservation.transactionId ? String(reservation.transactionId) : null,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
  };
}

function serializeTableReservation(reservation) {
  return {
    _id: String(reservation._id),
    kind: "table",
    reference: String(reservation._id),
    guestName: reservation.guestName,
    email: reservation.email,
    phone: reservation.phone,
    status: reservation.status,
    reservationDate: reservation.reservationDate,
    reservationTime: reservation.reservationTime,
    partySize: reservation.partySize,
    areaPreference: reservation.areaPreference,
    occasion: reservation.occasion,
    specialRequests: reservation.specialRequests,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
  };
}

function buildStayQuery(search, status) {
  const query = {};

  if (status && status !== "all") {
    query.status = status;
  }

  const normalizedSearch = normalizeString(search);
  if (normalizedSearch) {
    const regex = { $regex: normalizedSearch, $options: "i" };
    const searchClauses = [
      { guestName: regex },
      { email: regex },
      { phone: regex },
      { roomName: regex },
    ];

    if (mongoose.Types.ObjectId.isValid(normalizedSearch)) {
      searchClauses.unshift({ _id: new mongoose.Types.ObjectId(normalizedSearch) });
    }

    query.$or = searchClauses;
  }

  return query;
}

function buildTableQuery(search, status) {
  const query = {};

  if (status && status !== "all") {
    query.status = status;
  }

  const normalizedSearch = normalizeString(search);
  if (normalizedSearch) {
    const regex = { $regex: normalizedSearch, $options: "i" };
    const searchClauses = [
      { guestName: regex },
      { email: regex },
      { phone: regex },
      { occasion: regex },
      { areaPreference: regex },
    ];

    if (mongoose.Types.ObjectId.isValid(normalizedSearch)) {
      searchClauses.unshift({ _id: new mongoose.Types.ObjectId(normalizedSearch) });
    }

    query.$or = searchClauses;
  }

  return query;
}

function buildSummary(reservations) {
  return reservations.reduce(
    (summary, reservation) => {
      summary.total += 1;
      summary[reservation.kind] += 1;

      if (STATUS_OPTIONS.includes(reservation.status)) {
        summary.byStatus[reservation.status] += 1;
      }

      return summary;
    },
    {
      total: 0,
      stay: 0,
      table: 0,
      byStatus: {
        requested: 0,
        confirmed: 0,
        cancelled: 0,
        completed: 0,
      },
    }
  );
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  await mongooseConnect();

  const page = Math.max(1, normalizeInteger(req.query.page, 1));
  const limit = Math.min(50, Math.max(1, normalizeInteger(req.query.limit, 12)));
  const search = normalizeString(req.query.search);
  const status = normalizeString(req.query.status).toLowerCase() || "all";
  const kind = normalizeString(req.query.kind).toLowerCase() || "all";

  try {
    const [stays, tables] = await Promise.all([
      kind === "table"
        ? Promise.resolve([])
        : HotelBooking.find(buildStayQuery(search, status)).sort({ createdAt: -1 }).lean(),
      kind === "stay"
        ? Promise.resolve([])
        : HotelTableReservation.find(buildTableQuery(search, status)).sort({ createdAt: -1 }).lean(),
    ]);

    const combinedReservations = [
      ...stays.map(serializeStayReservation),
      ...tables.map(serializeTableReservation),
    ].sort((leftValue, rightValue) => new Date(rightValue.createdAt) - new Date(leftValue.createdAt));

    const total = combinedReservations.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const startIndex = (page - 1) * limit;

    return res.status(200).json({
      reservations: combinedReservations.slice(startIndex, startIndex + limit),
      total,
      totalPages,
      summary: buildSummary(combinedReservations),
    });
  } catch (error) {
    console.error("Failed to fetch hotel reservations:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}