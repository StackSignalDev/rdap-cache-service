import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import ipaddr from 'ipaddr.js';
import { IpCache, DomainCache, Prisma } from '@prisma/client';

import { rdapClientInstance } from '@/lib/rdapClient';

import {
  isRdapError,
  isRdapDomainResponse,
  isRdapIpNetworkResponse,
  RdapQueryResult,
  RdapError,
} from '@/lib/types';

function isIpAddress(query: string): boolean {
  try {
    ipaddr.process(query);
    return true;
  } catch (e) {
    console.log('Invalid IP address:', query, "Error:", e);
    return false;
  }
}

function isDomain(query: string): boolean {
  return (
    query.includes('.') &&
    !/^[.-]|[-.]$/.test(query) &&
    !isIpAddress(query) &&
    /^[a-zA-Z0-9.-]+$/.test(query)
  );
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');

  if (!query || typeof query !== 'string' || query.trim() === '') {
    return NextResponse.json(
      {
        message: 'Query parameter is required and must be a non-empty string.',
      },
      { status: 400 }
    );
  }

  const searchTerm = query.trim();
  let result: IpCache | DomainCache | null = null;
  let queryType: 'ip' | 'domain' | 'unknown' = 'unknown';

  try {
    console.log(`API Route: Processing query: ${searchTerm}`);

    if (isIpAddress(searchTerm)) {
      queryType = 'ip';
      console.log(
        `API Route: Detected as IP/CIDR. Searching IpCache using containment logic for: ${searchTerm}`
      );

      try {
        const resultsArray = await prisma.$queryRaw<IpCache[]>`
                SELECT * FROM "IpCache"
                WHERE "cidrBlock"::inet >>= ${searchTerm}::inet
                ORDER BY masklen("cidrBlock"::inet) DESC
                LIMIT 1
            `;
        result = resultsArray.length > 0 ? resultsArray[0] : null;      
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (dbError: any) {
        
        if (dbError.message?.includes('invalid input syntax for type inet')) {
          console.warn(
            `API Route: Invalid inet format for queryRaw: ${searchTerm}. Treating as cache miss.`
          );
          result = null;
        } else {
          throw dbError;
        }
      }
    } else if (isDomain(searchTerm)) {
      queryType = 'domain';
      console.log(
        `API Route: Detected as Domain. Searching DomainCache for: ${searchTerm.toLowerCase()}`
      );
      result = await prisma.domainCache.findUnique({
        where: { domainName: searchTerm.toLowerCase() },
      });
    } else {
      console.log(
        `API Route: Query type unknown or invalid format for: ${searchTerm}`
      );
      return NextResponse.json(
        {
          message: `Query format not recognized as a valid IP Address/CIDR or Domain: ${searchTerm}`,
        },
        { status: 400 }
      );
    }

    if (result) {
      console.log(
        `API Route: Cache hit for ${queryType} query: ${searchTerm}. Found ID: ${result.id}`
      );

      const rdapResponse = result.data as object;
      return NextResponse.json(
        { rdapResponse, cacheStatus: 'hit', type: queryType },
        { status: 200 }
      );
    } else {
      console.log(
        `API Route: Cache miss for ${queryType} query: ${searchTerm}. Performing live lookup...`
      );

      let liveResult: RdapQueryResult | null = null;

      if (queryType === 'ip') {
        liveResult = await rdapClientInstance.queryIp(searchTerm);
      } else if (queryType === 'domain') {
        liveResult = await rdapClientInstance.queryDomain(searchTerm);
      }

      if (!liveResult || isRdapError(liveResult)) {
        const errorResponse =
          liveResult ||
          ({
            errorCode: 500,
            title: 'RDAP Client Error',
            description: ['Failed to retrieve live RDAP data.'],
          } as RdapError);

        console.error(
          `API Route: Live RDAP query failed for ${searchTerm}:`,
          errorResponse
        );

        const status =
          errorResponse.errorCode && errorResponse.errorCode >= 400
            ? errorResponse.errorCode
            : 404;
        return NextResponse.json(errorResponse, { status });
      }

      let newCacheEntry: IpCache | DomainCache | null = null;
      try {
        if (queryType === 'ip' && isRdapIpNetworkResponse(liveResult)) {
          let cidrToCache: string | null = null;
          if (liveResult.cidr) {
            cidrToCache = liveResult.cidr;
          } else if (
            Array.isArray(liveResult.cidr0_cidrs) &&
            liveResult.cidr0_cidrs.length > 0
          ) {
            const cidr0Entry = liveResult.cidr0_cidrs.find(
              (c) => c.v4prefix && c.length
            );
            if (cidr0Entry) {
              cidrToCache = `${cidr0Entry.v4prefix}/${cidr0Entry.length}`;
              console.log(
                `API Route: Found CIDR in cidr0_cidrs extension: ${cidrToCache}`
              );
            }
          } else if (liveResult.startAddress && liveResult.endAddress) {
            console.log(
              'API Route: Need to calculate CIDR from start/end address...'
            );
          }

          if (cidrToCache) {
            console.log(
              `API Route: Caching successful live IP RDAP result for CIDR: ${cidrToCache}`
            );
            newCacheEntry = await prisma.ipCache.create({
              data: {
                cidrBlock: cidrToCache,
                data: liveResult as unknown as Prisma.JsonObject,
              },
            });
            console.log(
              `API Route: Cached IP data with ID: ${newCacheEntry.id}`
            );
          } else {
            console.warn(
              `API Route: Live IP RDAP result for ${searchTerm} lacks a usable 'cidr' field or recognized extension. Skipping cache insertion.`
            );

            console.log(
              'Live Result (No CIDR Found):',
              JSON.stringify(liveResult, null, 2)
            );
          }
        } else if (queryType === 'domain' && isRdapDomainResponse(liveResult)) {
          console.log(
            `API Route: Caching successful live Domain RDAP result for: ${searchTerm.toLowerCase()}`
          );
          newCacheEntry = await prisma.domainCache.create({
            data: {
              domainName: searchTerm.toLowerCase(),
              data: liveResult as unknown as Prisma.JsonObject,
            },
          });
          console.log(
            `API Route: Cached Domain data with ID: ${newCacheEntry.id}`
          );
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (cacheError: any) {
        if (cacheError.code === 'P2002') {
          console.warn(
            `API Route: Cache entry for ${searchTerm} likely created by a concurrent request.`
          );
        } else {
          console.error(
            `API Route: Failed to cache live RDAP result for ${searchTerm}:`,
            cacheError.message
          );
        }
      }

      console.log(
        `API Route: Returning live RDAP result for ${queryType} query: ${searchTerm}`
      );

      return NextResponse.json(
        { rdapResponse: liveResult, cacheStatus: 'miss', type: queryType },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error(
      `API Route Error processing ${queryType} query "${searchTerm}":`,
      error
    );
    let errorMessage = 'Internal Server Error.';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json(
      {
        message: 'Internal Server Error while processing RDAP query.',
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
