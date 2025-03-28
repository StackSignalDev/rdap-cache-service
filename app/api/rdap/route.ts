// app/api/rdap/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma'; // Adjust import path if needed
import ipaddr from 'ipaddr.js'; // Library to help parse/validate IPs
import { IpCache, DomainCache, Prisma } from '@prisma/client'; // Import the generated types and Prisma namespace

// Import RDAP Client and necessary types/guards
import { rdapClientInstance } from '@/lib/rdapClient'; // Adjust path

import {
  isRdapError, 
  isRdapDomainResponse, 
  isRdapIpNetworkResponse,
  RdapQueryResult,
  RdapError
} from '@/lib/types';

function isIpAddress(query: string): boolean {
  try {
    ipaddr.process(query);
    return true;
  } catch (e) {
    return false;
  }
}

function isDomain(query: string): boolean {
  return query.includes('.') &&
    !/^[.-]|[-.]$/.test(query) &&
    !isIpAddress(query) && 
    /^[a-zA-Z0-9.-]+$/.test(query);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');

  if (!query || typeof query !== 'string' || query.trim() === '') {
    return NextResponse.json(
      { message: 'Query parameter is required and must be a non-empty string.' },
      { status: 400 }
    );
  }

  const searchTerm = query.trim();
  let result: IpCache | DomainCache | null = null;
  let queryType: 'ip' | 'domain' | 'unknown' = 'unknown';

  try {
    console.log(`API Route: Processing query: ${searchTerm}`);

    // --- Determine Query Type and Search Appropriate Table ---
    if (isIpAddress(searchTerm)) { // Checks for IP or CIDR format
      queryType = 'ip';
      console.log(`API Route: Detected as IP/CIDR. Searching IpCache using containment logic for: ${searchTerm}`);

      try {
        // Use $queryRaw for IP containment lookup in PostgreSQL
        const resultsArray = await prisma.$queryRaw<IpCache[]>`
                SELECT * FROM "IpCache"
                WHERE "cidrBlock"::inet >>= ${searchTerm}::inet
                ORDER BY masklen("cidrBlock"::inet) DESC
                LIMIT 1
            `;
        result = resultsArray.length > 0 ? resultsArray[0] : null;
      } catch (dbError: any) {
        // Handle potential errors if searchTerm is not valid inet format for the query
        if (dbError.message?.includes('invalid input syntax for type inet')) {
          console.warn(`API Route: Invalid inet format for queryRaw: ${searchTerm}. Treating as cache miss.`);
          result = null; // Ensure result is null if query fails
        } else {
          throw dbError; // Re-throw other DB errors
        }
      }

    } else if (isDomain(searchTerm)) {
      queryType = 'domain';
      console.log(`API Route: Detected as Domain. Searching DomainCache for: ${searchTerm.toLowerCase()}`);
      result = await prisma.domainCache.findUnique({
        where: { domainName: searchTerm.toLowerCase() },
      });
    } else {
      console.log(`API Route: Query type unknown or invalid format for: ${searchTerm}`);
      return NextResponse.json(
        { message: `Query format not recognized as a valid IP Address/CIDR or Domain: ${searchTerm}` },
        { status: 400 }
      );
    }
    // --- End Type Determination ---


    // --- 3. Handle results ---
    if (result) {
      // Cache Hit
      console.log(`API Route: Cache hit for ${queryType} query: ${searchTerm}. Found ID: ${result.id}`);
      // Return the data stored in the cache (which is the RDAP response)
      return NextResponse.json({ ...(result.data as object), type: queryType }, { status: 200 }); // OK
    } else {
      // Cache Miss - Perform Live RDAP Query
      console.log(`API Route: Cache miss for ${queryType} query: ${searchTerm}. Performing live lookup...`);

      let liveResult: RdapQueryResult | null = null;

      // Call the appropriate RDAP client method
      if (queryType === 'ip') {
        liveResult = await rdapClientInstance.queryIp(searchTerm);
      } else if (queryType === 'domain') {
        liveResult = await rdapClientInstance.queryDomain(searchTerm);
      }

      // Check if the live query itself failed or returned an RDAP error object
      if (!liveResult || isRdapError(liveResult)) {
        const errorResponse = liveResult || { // Provide a default if liveResult is null
          errorCode: 500,
          title: "RDAP Client Error",
          description: ["Failed to retrieve live RDAP data."]
        } as RdapError;

        console.error(`API Route: Live RDAP query failed for ${searchTerm}:`, errorResponse);
        // Use error code from RDAP response if possible, default to 404/500
        const status = errorResponse.errorCode && errorResponse.errorCode >= 400 ? errorResponse.errorCode : 404;
        return NextResponse.json(errorResponse, { status });
      }

      // --- Live Query Success - Attempt to Cache ---
      let newCacheEntry: IpCache | DomainCache | null = null;
      try {
        if (queryType === 'ip' && isRdapIpNetworkResponse(liveResult)) {
          // Only cache if the response contains a usable CIDR block
          if (liveResult.cidr) {
            console.log(`API Route: Caching successful live IP RDAP result for CIDR: ${liveResult.cidr}`);
            newCacheEntry = await prisma.ipCache.create({
              data: {
                cidrBlock: liveResult.cidr, // Use CIDR from RDAP response
                data: liveResult as unknown as Prisma.JsonObject, // Store the full response JSON
              },
            });
            console.log(`API Route: Cached IP data with ID: ${newCacheEntry.id}`);
          } else {
            console.warn(`API Route: Live IP RDAP result for ${searchTerm} lacks a 'cidr' field. Skipping cache insertion.`);
          }
        } else if (queryType === 'domain' && isRdapDomainResponse(liveResult)) {
          console.log(`API Route: Caching successful live Domain RDAP result for: ${searchTerm.toLowerCase()}`);
          newCacheEntry = await prisma.domainCache.create({
            data: {
              domainName: searchTerm.toLowerCase(), // Use lowercase for consistency
              data: liveResult as unknown as Prisma.JsonObject, // Store the full response JSON
            },
          });
          console.log(`API Route: Cached Domain data with ID: ${newCacheEntry.id}`);
        }
      } catch (cacheError: any) {
        // Log caching error, but don't fail the request - return the live data anyway
        if (cacheError.code === 'P2002') { // Handle unique constraint violation gracefully
          console.warn(`API Route: Cache entry for ${searchTerm} likely created by a concurrent request.`);
        } else {
          console.error(`API Route: Failed to cache live RDAP result for ${searchTerm}:`, cacheError.message);
        }
        // Proceed to return the liveResult even if caching failed
      }

      // --- Return the successful live result ---
      console.log(`API Route: Returning live RDAP result for ${queryType} query: ${searchTerm}`);
      // Add the type for the frontend
      return NextResponse.json({ ...liveResult, type: queryType }, { status: 200 }); // OK
    }
  } catch (error) {
    // --- 4. Handle potential errors ---
    console.error(`API Route Error processing ${queryType} query "${searchTerm}":`, error);
    let errorMessage = 'Internal Server Error.';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json(
      { message: 'Internal Server Error while processing RDAP query.', error: errorMessage },
      { status: 500 }
    );
  }
}