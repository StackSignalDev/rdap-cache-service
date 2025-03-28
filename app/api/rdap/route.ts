// app/api/rdap/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma'; // Adjust import path if needed
import ipaddr from 'ipaddr.js'; // Library to help parse/validate IPs
import { IpCache, DomainCache } from '@prisma/client'; // Import the generated types

// Helper function to check if a string is a valid single IP address (v4 or v6)
function isIpAddress(query: string): boolean {
  // ipaddr.isValid() checks specifically for valid IPv4 or IPv6 addresses,
  // returning false for CIDR notation.
  return ipaddr.isValid(query);
}

// Helper function to check if a string looks like a domain name
// Basic check - might need refinement for edge cases (IDNs, etc.)
function isDomain(query: string): boolean {
  // Very basic check: contains a dot, doesn't start/end with dot/hyphen, not an IP, common chars
  return query.includes('.') &&
         !/^[.-]|[-.]$/.test(query) &&
         !isIpAddress(query) && // Ensure it's not parseable as an IP
         /^[a-zA-Z0-9.-]+$/.test(query); // Allow letters, numbers, dots, hyphens
}


export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');

  // 1. Validate the query parameter
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return NextResponse.json(
      { message: 'Query parameter is required and must be a non-empty string.' },
      { status: 400 } // Bad Request
    );
  }

  const searchTerm = query.trim();
  // Declare result with the correct union type
  let result: IpCache | DomainCache | null = null;
  let queryType: 'ip' | 'domain' | 'unknown' = 'unknown';

  // 2. Query the database using Prisma Client within a try...catch block
  try {
    console.log(`API Route: Processing query: ${searchTerm}`);

    // --- Determine Query Type and Search Appropriate Table ---
    if (isIpAddress(searchTerm)) {
        queryType = 'ip';
        console.log(`API Route: Detected as IP Address. Searching IpCache using containment logic for: ${searchTerm}`);

        // Use $queryRaw for IP containment lookup in PostgreSQL
        const resultsArray = await prisma.$queryRaw<IpCache[]>`
            SELECT * FROM "IpCache"
            WHERE "cidrBlock"::inet >>= ${searchTerm}::inet
            ORDER BY masklen("cidrBlock"::inet) DESC
            LIMIT 1
        `;

        // Assign result from the array if found
        if (resultsArray.length > 0) {
            result = resultsArray[0];
        } else {
            result = null;
        }

    } else if (isDomain(searchTerm)) {
        queryType = 'domain';
        console.log(`API Route: Detected as Domain. Searching DomainCache for: ${searchTerm}`);

        // Use findUnique for domain lookup
        result = await prisma.domainCache.findUnique({
            where: {
                domainName: searchTerm
                // Uncomment for case-insensitive search on PostgreSQL:
                // domainName: { equals: searchTerm, mode: 'insensitive' }
            },
        });
    } else {
        // Handle unrecognized query format (not IP or Domain, or invalid)
        console.log(`API Route: Query type unknown or invalid format for: ${searchTerm}`);
        return NextResponse.json(
            { message: `Query format not recognized as a valid IP Address or Domain: ${searchTerm}` },
            { status: 400 } // Bad Request
        );
    }
    // --- End Type Determination ---


    // --- 3. Handle results ---
    if (result) {
      // Cache Hit
      console.log(`API Route: Cache hit for ${queryType} query: ${searchTerm}. Found ID: ${result.id}`);
      // Add the determined type to the response for the frontend
      return NextResponse.json({ ...result, type: queryType }, { status: 200 }); // OK
    } else {
      // Cache Miss
      console.log(`API Route: Cache miss for ${queryType} query: ${searchTerm}`);
      // TODO: Optionally trigger a live RDAP lookup here in the future
      return NextResponse.json(
        { message: `No cached RDAP data found for ${queryType} query: ${searchTerm}` },
        { status: 404 } // Not Found
      );
    }
  } catch (error) {
    // --- 4. Handle potential errors ---
    console.error(`API Route Error processing ${queryType} query:`, error);
    let errorMessage = 'Internal Server Error while querying cache.';
    // Add more specific error message if possible
    if (error instanceof Error) {
        errorMessage = error.message;
    }
     // Return a 500 Internal Server Error response
     return NextResponse.json(
      { message: 'Internal Server Error while querying cache.', error: errorMessage }, // Include error details
      { status: 500 }
    );
  }
}

// Optional: Add basic OPTIONS handler if needed for CORS in some scenarios
// export async function OPTIONS(request: NextRequest) {
//   return new NextResponse(null, { status: 204 }); // No Content
// }