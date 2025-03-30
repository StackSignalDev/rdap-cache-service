import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma'; // Use centralized prisma client
import { Prisma } from '@prisma/client'; // Import model and Prisma namespace
import { z } from 'zod';
import { resolve as resolveDns } from 'node:dns/promises';

// --- Define Input Schema ---
// Zod schema handles validation and lowercase transformation
const QuerySchema = z.object({
    domainName: z.string().min(1, { message: 'Domain name cannot be empty.'})
    .transform(val => {
        try {
            // Try parsing as URL first to extract hostname robustly
            const url = new URL(val.includes('://') ? val : `http://${val}`); // Add protocol if missing for URL parser
            return url.hostname.toLowerCase();
        } catch {
            // If not a valid URL structure, assume it's a plain domain and lowercase it
            return val.toLowerCase();
        }
    })
    // Add refinement if needed, e.g., basic domain regex check after transform
    // .refine(val => /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(val), { message: "Invalid domain format" })
});

// --- Define Structure for storing records in JSON ---
interface RecordStorage {
  records: string[] | object[];
}

interface CacheJsonStructure {
  A?: RecordStorage;
  AAAA?: RecordStorage;
  // No index signature here
}

// --- Helper Function for Concurrent A/AAAA DNS Resolution ---
async function performAddressLookups(domainName: string): Promise<{ aRecords: string[], aaaaRecords: string[] }> {
  console.log(`DNS Helper: Performing A/AAAA lookups for ${domainName}`);
  let aRecords: string[] = [];
  let aaaaRecords: string[] = [];

  try {
    const results = await Promise.allSettled([
      resolveDns(domainName, 'A'),
      resolveDns(domainName, 'AAAA'),
    ]);

    // Process A results
    if (results[0].status === 'fulfilled') {
      aRecords = results[0].value;
      console.log(`DNS Helper: Found A records for ${domainName}: ${aRecords.length}`);
    } else {
        // Log only actual errors, not just "no data"
      if (results[0].reason?.code !== 'ENODATA' && results[0].reason?.code !== 'ENOTFOUND') {
        console.error(`DNS Helper: Lookup error for ${domainName} [A]:`, results[0].reason);
      } else {
        console.log(`DNS Helper: No A records found for ${domainName} (${results[0].reason?.code})`);
      }
    }

     // Process AAAA results
     if (results[1].status === 'fulfilled') {
        aaaaRecords = results[1].value;
        console.log(`DNS Helper: Found AAAA records for ${domainName}: ${aaaaRecords.length}`);
      } else {
         if (results[1].reason?.code !== 'ENODATA' && results[1].reason?.code !== 'ENOTFOUND') {
           console.error(`DNS Helper: Lookup error for ${domainName} [AAAA]:`, results[1].reason);
         } else {
           console.log(`DNS Helper: No AAAA records found for ${domainName} (${results[1].reason?.code})`);
         }
      }

    return { aRecords, aaaaRecords };

  } catch (error) {
      // This catch is for errors in Promise.allSettled setup itself (less likely)
      console.error(`DNS Helper: Unexpected error during lookup setup for ${domainName}:`, error);
      // Re-throw to be caught by the main handler
      throw new Error(`Failed to initiate DNS lookups for ${domainName}`);
  }
}


// --- API Route Handler (GET) ---
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawDomainName = searchParams.get('domainName');

   // 1. Validate Input using Zod
   const validationResult = QuerySchema.safeParse({ domainName: rawDomainName });

   if (!validationResult.success) {
     console.log("API Route: Invalid input -", validationResult.error.flatten());
     return NextResponse.json(
       { message: 'Invalid query parameter: domainName required and must be valid.',
         errors: validationResult.error.flatten().fieldErrors },
       { status: 400 }
     );
   }

   // domainName is now validated and normalized (lowercase hostname)
   const { domainName } = validationResult.data;
   console.log(`API Route: Processing DNS query for: ${domainName} (Raw input: ${rawDomainName})`);


  try {
    // 2. Check Cache (No TTL/Expiry Check)
    console.log(`API Route: Checking DnsCache for ${domainName}`);
    const cachedDbEntry = await prisma.dnsCache.findUnique({
      where: { domainName },
      select: { records: true } // Optimization
    });

    if (cachedDbEntry) {
      // Cache hit!
      console.log(`API Route: Cache HIT for ${domainName}. Returning cached A/AAAA records.`);
      // Safely parse JSON, default to empty object if null/invalid
      const cacheData = (cachedDbEntry.records ?? {}) as CacheJsonStructure;

      return NextResponse.json({
        // Aligning response structure slightly with RDAP for consistency
        domainName: domainName,
        cacheStatus: 'hit', // Use cacheStatus like RDAP
        aRecords: cacheData.A?.records ?? [],
        aaaaRecords: cacheData.AAAA?.records ?? [],
      });
    }

    // 3. Perform Live DNS Lookups (Cache miss)
    console.log(`API Route: Cache MISS for ${domainName}. Performing LIVE lookups [A & AAAA]`);
    const { aRecords, aaaaRecords } = await performAddressLookups(domainName);

    // 4. Prepare data for NEW cache entry
    const newCacheData: CacheJsonStructure = {
      A: { records: aRecords },
      AAAA: { records: aaaaRecords },
    };

    // 5. Create Cache Entry in DB
    try {
        console.log(`API Route: Caching live results for ${domainName}`);
        await prisma.dnsCache.create({
          data: {
            domainName: domainName,
            // Cast to Prisma.JsonValue. Prisma ensures it's valid JSON for the DB.
            records: newCacheData as Prisma.JsonObject,
          },
        });
        console.log(`API Route: Cache CREATED for ${domainName} [A & AAAA]`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (cacheError: any) {
        // Handle potential Prisma unique constraint violation (race condition)
        if (cacheError instanceof Prisma.PrismaClientKnownRequestError && cacheError.code === 'P2002') {
            console.warn(`API Route: Cache entry for ${domainName} likely created by a concurrent request (P2002). Proceeding without caching.`);
            // In a write-once strategy, if it already exists (due to race condition),
            // we can just return the live data we fetched without erroring.
            // The next request will get the data cached by the other process.
        } else {
            // Log other database errors during cache write
            console.error(`API Route: Failed to cache DNS results for ${domainName}:`, cacheError);
            // Decide if this should be fatal. Maybe not, we can still return live data.
            // For now, just log it. Consider adding monitoring here.
        }
    }

    // 6. Return Live Lookup Result
    console.log(`API Route: Returning live lookup results for ${domainName}`);
    return NextResponse.json({
        domainName: domainName,
        cacheStatus: 'miss', // Use cacheStatus like RDAP
        aRecords: aRecords,
        aaaaRecords: aaaaRecords,
    });

  } catch (error: any) {
    // Catch errors from performAddressLookups or other unexpected issues
    console.error(`API Route: Unhandled error processing DNS query for "${domainName}":`, error);
    return NextResponse.json(
        { message: 'Internal Server Error while processing DNS query.', error: error.message },
        { status: 500 }
    );
  } finally {
      // Disconnect might not be needed depending on Prisma setup (e.g., Next.js recommendation)
      // await prisma.$disconnect();
  }
}