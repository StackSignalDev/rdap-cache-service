// app/api/rdap/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma'; // Adjust import path if needed
import ipaddr from 'ipaddr.js'; // Library to help parse/validate IPs and CIDRs

// Helper function to check if a string is likely an IP address or CIDR
function isIpOrCidr(query: string): boolean {
  try {
    // ipaddr.js can parse both single IPs and CIDR ranges
    ipaddr.parse(query);
    return true;
  } catch (e) {
    // If parsing fails, it's likely not a valid IP or CIDR
    return false;
  }
}

// Helper function to check if a string looks like a domain name
// Basic check - might need refinement for edge cases (IDNs, etc.)
function isDomain(query: string): boolean {
  // Very basic check: contains a dot, doesn't start/end with dot/hyphen, no IP chars
  return query.includes('.') &&
         !/^[.-]|[-.]$/.test(query) &&
         !isIpOrCidr(query) && // Ensure it's not also parseable as an IP
         /^[a-zA-Z0-9.-]+$/.test(query); // Allow letters, numbers, dots, hyphens
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
  let result = null;
  let queryType: 'ip' | 'domain' | 'unknown' = 'unknown';

  try {
    console.log(`API Route: Processing query: ${searchTerm}`);

    // --- Determine Query Type and Search Appropriate Table ---
    if (isIpOrCidr(searchTerm)) {
        queryType = 'ip';
        console.log(`API Route: Detected as IP/CIDR. Searching IpCache for: ${searchTerm}`);
        // TODO: Implement IP/CIDR containment logic if needed, or just direct lookup for now
        // For simple direct lookup (if you store exact IPs/CIDRs):
        result = await prisma.ipCache.findUnique({
            where: { cidrBlock: searchTerm },
        });
        // --- Placeholder for CIDR Containment Logic ---
        // If you need to find the containing block for a single IP:
        // This requires more complex SQL or specific Prisma features/extensions
        // like pg_net or custom queries. For now, we'll stick to direct match.
        // console.warn("CIDR containment search not yet implemented.");
        // --- End Placeholder ---

    } else if (isDomain(searchTerm)) {
        queryType = 'domain';
        console.log(`API Route: Detected as Domain. Searching DomainCache for: ${searchTerm}`);
        // Perform case-insensitive search for domains if desired and supported
        result = await prisma.domainCache.findUnique({
            where: {
                domainName: searchTerm
                // Example for case-insensitive on PostgreSQL:
                // domainName: { equals: searchTerm, mode: 'insensitive' }
            },
        });
    } else {
        console.log(`API Route: Query type unknown for: ${searchTerm}`);
        return NextResponse.json(
            { message: `Query format not recognized as IP, CIDR, or Domain: ${searchTerm}` },
            { status: 400 } // Bad Request - Invalid query format
        );
    }
    // --- End Type Determination ---


    // --- Handle results ---
    if (result) {
      console.log(`API Route: Cache hit for ${queryType} query: ${searchTerm}`);
      // Add the determined type to the response for the frontend
      return NextResponse.json({ ...result, type: queryType }, { status: 200 });
    } else {
      console.log(`API Route: Cache miss for ${queryType} query: ${searchTerm}`);
      // TODO: Optionally trigger a live RDAP lookup here
      return NextResponse.json(
        { message: `No cached RDAP data found for ${queryType} query: ${searchTerm}` },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error(`API Route Error processing ${queryType} query:`, error);
    return NextResponse.json(
      { message: 'Internal Server Error while querying cache.' },
      { status: 500 }
    );
  }
}