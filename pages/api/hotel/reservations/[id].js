import mongoose from "mongoose";
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { createHotelEmailHtml, HOTEL_BRAND_NAME } from "@/lib/hotelEmailTemplates";
import { createMailTransport, getMailFromAddress } from "@/lib/mail";
import HotelBooking from "@/models/HotelBooking";
import HotelTableReservation from "@/models/HotelTableReservation";
import Product from "@/models/Product";
import Store from "@/models/Store";
import Transaction from "@/models/Transactions";

const STATUS_OPTIONS = ["requested", "confirmed", "cancelled", "completed"];

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toSafeNumber(value, fallback = 0) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function normalizeObjectId(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value.toString === "function") return value.toString().trim();
  return "";
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

function getStatusEmailContent({ kind, reservation, store }) {
  const companyLabel = HOTEL_BRAND_NAME;
  const supportEmail = store?.email || process.env.EMAIL_USER || "the hotel team";
  const supportPhone = store?.storePhone || "our reservations desk";
  const guestName = reservation.guestName || "Guest";
  const titlePrefix = kind === "stay" ? "stay request" : "table reservation";
  const summaryRows =
    kind === "stay"
      ? [
          { label: "Reference", value: String(reservation._id) },
          { label: "Room", value: reservation.roomName || "Any available room" },
          {
            label: "Stay",
            value: `${reservation.checkInDate.toISOString().slice(0, 10)} to ${reservation.checkOutDate.toISOString().slice(0, 10)}`,
          },
          {
            label: "Guests",
            value: `${reservation.adults} adult${reservation.adults === 1 ? "" : "s"}${reservation.children ? `, ${reservation.children} child${reservation.children === 1 ? "" : "ren"}` : ""}`,
          },
          reservation.roomRate ? { label: "Room rate", value: `NGN ${Number(reservation.roomRate).toLocaleString()}` } : null,
          reservation.totalAmount ? { label: "Total amount", value: `NGN ${Number(reservation.totalAmount).toLocaleString()}` } : null,
          reservation.preferredArrivalTime ? { label: "Arrival", value: reservation.preferredArrivalTime } : null,
          reservation.specialRequests ? { label: "Notes", value: reservation.specialRequests } : null,
        ]
      : [
          { label: "Reference", value: String(reservation._id) },
          { label: "Date", value: reservation.reservationDate.toISOString().slice(0, 10) },
          { label: "Time", value: reservation.reservationTime },
          { label: "Party size", value: String(reservation.partySize) },
          reservation.areaPreference ? { label: "Area", value: reservation.areaPreference } : null,
          reservation.occasion ? { label: "Occasion", value: reservation.occasion } : null,
          reservation.specialRequests ? { label: "Notes", value: reservation.specialRequests } : null,
        ];
  const summaryText = summaryRows
    .filter(Boolean)
    .map((row) => `${row.label}: ${row.value}`)
    .join("\n");

  const contentByStatus = {
    confirmed: {
      subject: kind === "stay" ? `${companyLabel} stay confirmed` : `${companyLabel} table confirmed`,
      heading: kind === "stay" ? "Your stay is confirmed" : "Your table is confirmed",
      message:
        kind === "stay"
          ? `We have confirmed your ${titlePrefix}. Our team will be ready for your arrival.`
          : `We have confirmed your ${titlePrefix}. Your table has been reserved by the hotel team.`,
      color: "#059669",
    },
    completed: {
      subject: kind === "stay" ? "Your hotel stay has been completed" : "Your lounge reservation has been completed",
      heading: kind === "stay" ? "Your stay is marked completed" : "Your reservation is marked completed",
      message:
        kind === "stay"
          ? `Your ${titlePrefix} has been marked as completed. Thank you for staying with ${companyLabel}.`
          : `Your ${titlePrefix} has been marked as completed. Thank you for dining with ${companyLabel}.`,
      color: "#1d4ed8",
    },
    cancelled: {
      subject: kind === "stay" ? "Your hotel stay has been cancelled" : "Your lounge reservation has been cancelled",
      heading: kind === "stay" ? "Your stay was cancelled" : "Your reservation was cancelled",
      message: `Your ${titlePrefix} has been cancelled by the hotel team. Contact us if you need to reschedule or submit a new request.`,
      color: "#dc2626",
    },
  };

  const selectedContent = contentByStatus[reservation.status];
  if (!selectedContent) {
    return null;
  }

  return {
    subject: selectedContent.subject,
    text: `Hi ${guestName},\n\n${selectedContent.message}\n\n${summaryText}\n\nIf you need help, contact us via ${supportEmail} or ${supportPhone}.`,
    html: createHotelEmailHtml({
      eyebrow:
        reservation.status === "confirmed"
          ? "Reservation confirmed"
          : reservation.status === "completed"
            ? "Reservation completed"
            : "Reservation cancelled",
      title: selectedContent.heading,
      greeting: `Hi ${guestName},`,
      intro: selectedContent.message,
      rows: summaryRows.filter(Boolean),
      closing: `If you need help, contact us via ${supportEmail} or ${supportPhone}.`,
    }),
  };
}

async function sendReservationStatusEmail({ kind, reservation }) {
  const transport = createMailTransport();
  if (!transport) {
    return "skipped";
  }

  const store = await Store.findOne({}).select("companyName storeName email storePhone").lean();
  const content = getStatusEmailContent({ kind, reservation, store });
  if (!content) {
    return "skipped";
  }

  try {
    await transport.sendMail({
      from: getMailFromAddress(HOTEL_BRAND_NAME),
      to: reservation.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    return "sent";
  } catch (error) {
    console.error("Hotel admin status email failed:", error);
    return "failed";
  }
}

function getBookingTransactionExternalId(reservationId) {
  return `hotel-booking:${reservationId}`;
}

function getBookingLocation(product) {
  const productLocations = Array.isArray(product?.locations)
    ? product.locations.map((value) => normalizeString(value)).filter(Boolean)
    : [];

  const hotelLocation = productLocations.find(
    (value) => value.toLowerCase() === "hotel"
  );

  return hotelLocation || productLocations[0] || "Hotel";
}

async function findRoomProduct(reservation) {
  const reservationRoomProductId = normalizeObjectId(reservation?.roomProduct);

  if (reservationRoomProductId && mongoose.Types.ObjectId.isValid(reservationRoomProductId)) {
    const roomProduct = await Product.findById(reservationRoomProductId)
      .select("name salePriceIncTax locations")
      .lean();
    if (roomProduct) {
      return roomProduct;
    }
  }

  const reservationRoomName = normalizeString(reservation?.roomName);
  if (!reservationRoomName) {
    return null;
  }

  return Product.findOne({
    name: { $regex: `^${reservationRoomName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
  })
    .select("name salePriceIncTax locations")
    .lean();
}

async function resolveStayTransactionSnapshot(reservation) {
  const roomProduct = await findRoomProduct(reservation);
  const nights = Math.max(1, Math.round(toSafeNumber(reservation?.nights, 1)));
  const storedTotalAmount = toSafeNumber(reservation?.totalAmount, 0);
  const storedRoomRate = toSafeNumber(reservation?.roomRate, 0);
  const resolvedRoomRate =
    storedRoomRate > 0
      ? storedRoomRate
      : storedTotalAmount > 0
        ? storedTotalAmount / nights
        : toSafeNumber(roomProduct?.salePriceIncTax, 0);
  const resolvedTotalAmount =
    storedTotalAmount > 0 ? storedTotalAmount : resolvedRoomRate * nights;

  if (!(resolvedRoomRate > 0) || !(resolvedTotalAmount > 0)) {
    return {
      error:
        "This stay booking does not have a room rate yet. Link it to a priced room product before marking it completed.",
    };
  }

  return {
    roomProduct,
    productId: roomProduct?._id || reservation?.roomProduct || null,
    roomName: normalizeString(reservation?.roomName) || roomProduct?.name || "Hotel room stay",
    roomRate: resolvedRoomRate,
    totalAmount: resolvedTotalAmount,
    nights,
    location: getBookingLocation(roomProduct),
  };
}

async function syncStayBookingTransaction({ reservation, status, user }) {
  const externalId = getBookingTransactionExternalId(reservation._id);

  if (status !== "completed") {
    const existingTransaction = await Transaction.findOne({ externalId });

    if (existingTransaction) {
      await Transaction.deleteOne({ _id: existingTransaction._id });
    }

    reservation.transactionId = null;
    reservation.completedAt = null;

    return {
      transactionState: existingTransaction ? "removed" : "skipped",
      transactionId: null,
      transactionTotal: 0,
    };
  }

  const snapshot = await resolveStayTransactionSnapshot(reservation);
  if (snapshot.error) {
    return { error: snapshot.error };
  }

  if (snapshot.roomProduct?._id && (!reservation.roomProduct || String(reservation.roomProduct) !== String(snapshot.roomProduct._id))) {
    reservation.roomProduct = snapshot.roomProduct._id;
  }

  if (!normalizeString(reservation.roomName)) {
    reservation.roomName = snapshot.roomName;
  }

  reservation.roomRate = snapshot.roomRate;
  reservation.totalAmount = snapshot.totalAmount;
  reservation.completedAt = reservation.completedAt || new Date();

  const items = [
    {
      productId: snapshot.productId,
      name: snapshot.roomName,
      salePriceIncTax: snapshot.roomRate,
      price: snapshot.roomRate,
      qty: snapshot.nights,
      quantity: snapshot.nights,
    },
  ];

  const transactionPayload = {
    tenderType: "ROOM",
    amountPaid: snapshot.totalAmount,
    total: snapshot.totalAmount,
    subtotal: snapshot.totalAmount,
    tax: 0,
    staff: null,
    staffName: normalizeString(user?.name) || "Hotel Booking",
    location: snapshot.location,
    device: "Hotel Booking",
    tableName: "Room Booking",
    discount: 0,
    discountReason: "",
    customerType: "Hotel Stay",
    customerName: reservation.guestName || "Hotel Guest",
    transactionType: "pos",
    status: "completed",
    change: 0,
    items,
    externalId,
    dedupeKey: externalId,
  };

  const existingTransaction = await Transaction.findOne({ externalId });
  let transaction = existingTransaction;
  let transactionState = "updated";

  if (transaction) {
    transaction.set(transactionPayload);
    await transaction.save();
  } else {
    transaction = await Transaction.create(transactionPayload);
    transactionState = "created";
  }

  reservation.transactionId = transaction._id;

  return {
    transactionState,
    transactionId: String(transaction._id),
    transactionTotal: snapshot.totalAmount,
  };
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method !== "PUT") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  await mongooseConnect();

  const reservationId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const kind = normalizeString(req.body.kind || req.query.kind).toLowerCase();
  const status = normalizeString(req.body.status).toLowerCase();

  if (!reservationId || !mongoose.Types.ObjectId.isValid(reservationId)) {
    return res.status(400).json({ error: "Reservation id is required" });
  }

  if (!["stay", "table"].includes(kind)) {
    return res.status(400).json({ error: "Reservation kind is required" });
  }

  if (!STATUS_OPTIONS.includes(status)) {
    return res.status(400).json({ error: `Invalid status: ${status}` });
  }

  try {
    const Model = kind === "stay" ? HotelBooking : HotelTableReservation;
    const reservation = await Model.findById(reservationId);

    if (!reservation) {
      return res.status(404).json({ error: "Reservation not found" });
    }

    reservation.status = status;
    reservation.cancelledAt = status === "cancelled" ? new Date() : null;

    let transactionResult = {
      transactionState: "skipped",
      transactionId: null,
      transactionTotal: 0,
    };

    if (kind === "stay") {
      transactionResult = await syncStayBookingTransaction({
        reservation,
        status,
        user: req.user,
      });

      if (transactionResult.error) {
        return res.status(400).json({ error: transactionResult.error });
      }
    }

    await reservation.save();

    const emailState = ["confirmed", "completed", "cancelled"].includes(status)
      ? await sendReservationStatusEmail({ kind, reservation })
      : "skipped";

    return res.status(200).json({
      ...(kind === "stay"
        ? serializeStayReservation(reservation)
        : serializeTableReservation(reservation)),
      emailState,
      transactionState: transactionResult.transactionState,
      transactionId: transactionResult.transactionId,
      transactionTotal: transactionResult.transactionTotal,
    });
  } catch (error) {
    console.error("Failed to update hotel reservation:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}