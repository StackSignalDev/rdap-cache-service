// lib/prisma.ts
import { PrismaClient } from '@prisma/client';

// Declare a global variable to hold the Prisma Client instance.
// This helps prevent creating multiple instances during hot-reloading in development.
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Instantiate PrismaClient.
// In development, reuse the existing instance attached to `globalThis` if it exists.
// In production, always create a new instance.
const prisma = globalThis.prisma || new PrismaClient({
    // Optional: Add logging configuration if needed
    // log: ['query', 'info', 'warn', 'error'],
});

// If in development, attach the instance to `globalThis`.
if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

export default prisma;