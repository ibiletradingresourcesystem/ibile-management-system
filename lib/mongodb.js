import mongoose from "mongoose";

if (!process.env.MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGODB_URI"');
}

const uri = process.env.MONGODB_URI;

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

export async function mongooseConnect() {
  if (cached.conn) {
    // Verify connection is still alive
    if (mongoose.connection.readyState === 1) {
      return cached.conn;
    }
    // Connection dropped, reset cache
    cached.conn = null;
    cached.promise = null;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      // Reduced pool size for serverless - prevents too many connections
      maxPoolSize: 5,
      minPoolSize: 1,
      // Connection timeouts
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      // Heartbeat to keep connections alive
      heartbeatFrequencyMS: 10000,
      // SSL/TLS configuration for Vercel
      tls: true,
      tlsAllowInvalidCertificates: false,
      tlsAllowInvalidHostnames: false,
      // Retry configuration
      retryWrites: true,
      retryReads: true,
      w: "majority",
      // Compression
      compressors: ["snappy", "zlib"],
      // Force new connection on serverless cold starts
      maxIdleTimeMS: 10000,
      // Direct connection for better reliability
      directConnection: false,
    };

    cached.promise = mongoose
      .connect(uri, opts)
      .then((mongoose) => {
        console.log("MongoDB connected successfully");
        return mongoose;
      })
      .catch((err) => {
        cached.promise = null;
        console.error("MongoDB connection error:", err.message);
        throw err;
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

// Retry wrapper for database operations with transient error handling
export async function withRetry(operation, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Ensure fresh connection on retry
      if (attempt > 1) {
        cached.conn = null;
        cached.promise = null;
      }
      await mongooseConnect();
      return await operation();
    } catch (error) {
      lastError = error;
      const isTransient = 
        error.name === 'MongoNetworkError' ||
        error.name === 'MongoPoolClearedError' ||
        error.code === 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR' ||
        error.message?.includes('SSL') ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('pool was cleared');
      
      if (isTransient && attempt < maxRetries) {
        console.log(`Retry attempt ${attempt}/${maxRetries} after transient error: ${error.message}`);
        // Exponential backoff: 500ms, 1000ms, 2000ms
        await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt - 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// Deprecated: Use mongooseConnect instead
export async function connectToDatabase() {
  return mongooseConnect();
}
