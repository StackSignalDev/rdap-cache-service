import axios, { AxiosInstance, AxiosError } from 'axios';
import { URL } from 'url';
import ipaddr from 'ipaddr.js'; // Use the installed library
import { BootstrapCache, BootstrapData, BootstrapServiceEntry, RdapDomainResponse, RdapError, RdapIpNetworkResponse, RdapQueryResult } from './types';

const IANA_BOOTSTRAP_URLS = {
    domain: 'https://data.iana.org/rdap/dns.json',
    ipv4: 'https://data.iana.org/rdap/ipv4.json',
    ipv6: 'https://data.iana.org/rdap/ipv6.json',
};

const DEFAULT_USER_AGENT = 'RDAPCache/1.0 (Node.js)'; // Customize URL
const DEFAULT_TIMEOUT = 10000; // 10 seconds
const MAX_REDIRECTS = 5;
const MAX_RETRIES = 2; // Slightly fewer retries perhaps

// Helper for exponential backoff
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Add these functions (e.g., within the RDAPClient class or outside)

export function isRdapError(obj: any): obj is RdapError {
    // Check if it looks like our defined RdapError type
    return typeof obj === 'object' && obj !== null && typeof obj.errorCode === 'number' && Array.isArray(obj.description);
}

export function isRdapDomainResponse(obj: any): obj is RdapDomainResponse {
    // Check for the specific objectClassName for domains
    return typeof obj === 'object' && obj !== null && obj.objectClassName === 'domain';
}

export function isRdapIpNetworkResponse(obj: any): obj is RdapIpNetworkResponse {
    // Check for the specific objectClassName for IP networks
    return typeof obj === 'object' && obj !== null && obj.objectClassName === 'ip network';
}

export class RDAPClient {
    private axiosInstance: AxiosInstance;
    private userAgent: string;
    private timeout: number;
    private maxRedirects: number;
    private maxRetries: number;
    private bootstrapCache: BootstrapCache = { domain: null, ipv4: null, ipv6: null, lastUpdated: null };
    private bootstrapLoadingPromise: Promise<BootstrapCache> | null = null;

    constructor(options: {
        userAgent?: string;
        timeout?: number;
        maxRedirects?: number;
        maxRetries?: number;
    } = {}) {
        this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
        this.timeout = options.timeout || DEFAULT_TIMEOUT;
        this.maxRedirects = options.maxRedirects || MAX_REDIRECTS;
        this.maxRetries = options.maxRetries || MAX_RETRIES;

        this.axiosInstance = axios.create({
            timeout: this.timeout,
            headers: {
                'Accept': 'application/rdap+json',
                'User-Agent': this.userAgent
            },
            maxRedirects: 0, // Handle manually
            validateStatus: (status) => status >= 200 && status < 300, // Only 2xx are success
        });

         // Immediately try to load bootstrap data in the background, non-blocking
        this.ensureBootstrapData().catch(err => {
            console.error("Initial background bootstrap load failed:", err.message);
            // Decide if this is critical. Maybe retry later?
        });
    }

    // --- Bootstrap Methods (Adapt from JS version using ipaddr.js) ---
    private async _fetchBootstrapFile(url: string): Promise<BootstrapData> {
         // ... (Implementation similar to JS version, using axios)
         // Make sure to return data conforming to BootstrapData type
         console.log(`Fetching bootstrap data from ${url}...`);
         const response = await axios.get<BootstrapData>(url, { timeout: this.timeout });
         if (response.status === 200 && response.data?.services && response.data?.version) {
             return response.data;
         }
         throw new Error(`Failed to fetch or parse bootstrap file ${url}: Status ${response.status}`);
    }

    async ensureBootstrapData(forceRefresh = false): Promise<BootstrapCache> {
        // If cache is fresh and not forcing refresh, return it
        if (this.bootstrapCache.lastUpdated && !forceRefresh) {
            const now = new Date();
            const ageHours = (now.getTime() - this.bootstrapCache.lastUpdated.getTime()) / (1000 * 60 * 60);
            if (ageHours < 24) { // Example: refresh if older than 24 hours
                return this.bootstrapCache;
            } else {
                console.log("Bootstrap data is older than 24 hours, initiating refresh.");
                forceRefresh = true; // Force refresh if stale
            }
        }

        if (this.bootstrapLoadingPromise) {
            return this.bootstrapLoadingPromise; // Return existing loading promise
        }

        // Only proceed with loading if needed (stale or forced)
         if (!this.bootstrapCache.lastUpdated || forceRefresh) {
            this.bootstrapLoadingPromise = (async () => {
                try {
                    console.log("Loading/Refreshing IANA Bootstrap Data...");
                    const [domainData, ipv4Data, ipv6Data] = await Promise.all([
                        this._fetchBootstrapFile(IANA_BOOTSTRAP_URLS.domain),
                        this._fetchBootstrapFile(IANA_BOOTSTRAP_URLS.ipv4),
                        this._fetchBootstrapFile(IANA_BOOTSTRAP_URLS.ipv6),
                    ]);

                    this.bootstrapCache = {
                        domain: domainData,
                        ipv4: ipv4Data,
                        ipv6: ipv6Data,
                        lastUpdated: new Date(),
                    };
                    console.log("Bootstrap data loaded/refreshed successfully.");
                    return this.bootstrapCache;
                } catch (error: any) {
                    console.error("Failed to load bootstrap data:", error.message);
                    // Keep stale data if available? Or clear? For now, clear on failure.
                    // this.bootstrapCache = { domain: null, ipv4: null, ipv6: null, asn: null, lastUpdated: this.bootstrapCache.lastUpdated }; // Keep old date?
                    throw new Error(`Failed to initialize/refresh bootstrap data: ${error.message}`);
                } finally {
                    this.bootstrapLoadingPromise = null;
                }
            })();
            return this.bootstrapLoadingPromise;
        } else {
             // Should not be reached if logic above is correct, but return current cache as fallback
             return Promise.resolve(this.bootstrapCache);
        }
    }

    private async _findServerUrl(query: string, queryType: 'domain' | 'ip'): Promise<string | null> {
        const bootstrap = await this.ensureBootstrapData(); // Ensure data is loaded/fresh
        if (!bootstrap.lastUpdated) { // Check if loading failed critically
             throw new Error("Bootstrap data is not available.");
        }

        let services: BootstrapServiceEntry[] | undefined;
        let matchKey: string | undefined;
        let baseUrls: string[] | undefined;

        try {
            switch (queryType) {
                case 'domain':
                    services = bootstrap.domain?.services;
                    if (!services) break;
                    const labels = query.toLowerCase().split('.');
                    for (let i = 0; i < labels.length - 1; i++) {
                        const tld = labels.slice(i).join('.');
                        const entry = services.find(service => service[0].includes(tld));
                        if (entry) {
                            matchKey = tld;
                            baseUrls = entry[1];
                            break;
                        }
                    }
                    break;

                case 'ip':
                    let addr: ipaddr.IPv4 | ipaddr.IPv6 | null = null;
                    try {
                         addr = ipaddr.parse(query);
                         services = addr.kind() === 'ipv6' ? bootstrap.ipv6?.services : bootstrap.ipv4?.services;
                    } catch (e) {
                        throw new Error(`Invalid IP address format: ${query}`);
                    }
                    if (!services) break;

                    const entryIp = services.find(service => {
                        return service[0].some(cidrStr => {
                            try {
                                const range = ipaddr.parseCIDR(cidrStr);
                                // ipaddr.js match returns [addr, bits] or throws
                                return addr!.match(range);
                            } catch (e) { return false; }
                        });
                    });
                     if (entryIp) {
                        matchKey = query;
                        baseUrls = entryIp[1];
                    }
                    break;
            }
        } catch (parseError: any) {
             console.error(`Error processing bootstrap lookup for '${query}' (${queryType}): ${parseError.message}`);
             throw parseError;
        }

        if (!baseUrls || baseUrls.length === 0) {
            console.warn(`No RDAP bootstrap server found for ${queryType} ${matchKey || query}`);
            return null; // Indicate bootstrap failure for this query
        }

        // Prefer HTTPS, allow HTTP as fallback (consider making this configurable)
        const httpsUrl = baseUrls.find(url => url.toLowerCase().startsWith('https://'));
        if (httpsUrl) return httpsUrl;
        const httpUrl = baseUrls.find(url => url.toLowerCase().startsWith('http://'));
        if (httpUrl) {
             console.warn(`Using non-HTTPS RDAP URL: ${httpUrl}`);
             return httpUrl;
        }

        console.error(`No suitable HTTPS or HTTP URL found in bootstrap entry for ${queryType} ${matchKey || query}`);
        return null;
    }


    // --- Request Method (_makeRequest - Adapt from JS version) ---
    // Use AxiosError type guard for better error handling
    private async _makeRequest(url: string, redirectCount = 0, attempt = 0): Promise<RdapQueryResult> { // Return type 'any' for now, could be more specific RDAP object type
        if (redirectCount > this.maxRedirects) {
            throw new Error(`Too many redirects encountered fetching ${url}`);
        }

        console.log(`RDAPClient: Attempt ${attempt + 1}/${this.maxRetries + 1}: Requesting ${url}`);

        try {
            const response = await this.axiosInstance.get(url);
            // Success (2xx) already validated by axiosInstance config
             if (response.headers['content-type']?.includes('application/rdap+json')) {
                return response.data; // Success!
            } else {
                console.warn(`RDAP server returned success status but unexpected Content-Type: ${response.headers['content-type']} for ${url}`);
                // Decide: throw or return data anyway? Let's return it for now.
                return response.data;
            }
        } catch (error) {
             if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError<any>; // Type assertion
                const response = axiosError.response;
                const request = axiosError.request;

                if (response) {
                    // Server responded with a status code outside the 2xx range
                    const status = response.status;
                    const headers = response.headers;
                    const responseData = response.data;

                    // Redirects (3xx)
                    if (status >= 300 && status < 400 && headers.location) {
                         const location = headers.location;
                         console.log(`RDAPClient: Following redirect (${status}) from ${url} to ${location}`);
                         const nextUrl = new URL(location, url).toString();
                         return this._makeRequest(nextUrl, redirectCount + 1, 0); // Reset attempt count
                    }

                    // Not Found (404) - Valid RDAP response
                    if (status === 404) {
                        console.log(`RDAPClient: RDAP Not Found (404) for ${url}`);
                        // Return the RDAP error object if server provided one, else a generic one
                        if (responseData && typeof responseData === 'object') return responseData;
                        return { errorCode: 404, title: "Not Found", description: ["The RDAP server could not find the requested resource."] } as RdapError;
                    }

                    // Rate Limit (429)
                    if (status === 429) {
                         if (attempt < this.maxRetries) {
                            const retryAfterHeader = headers['retry-after'];
                            const retryAfterSec = typeof retryAfterHeader === 'string' ? parseInt(retryAfterHeader, 10) : NaN;
                            const waitTimeMs = isNaN(retryAfterSec)
                                ? Math.pow(2, attempt) * 1000 + Math.random() * 1000 // Exponential backoff + jitter
                                : retryAfterSec * 1000 + Math.random() * 500; // Use header + jitter
                            console.warn(`RDAPClient: Rate limited (429) on ${url}. Retrying in ${waitTimeMs / 1000}s...`);
                            await delay(waitTimeMs);
                            return this._makeRequest(url, redirectCount, attempt + 1);
                         } else {
                             console.error(`RDAPClient: Rate limited (429) on ${url} after ${attempt + 1} attempts.`);
                             // Return RDAP error object if available
                             if (responseData && typeof responseData === 'object') return responseData;
                             throw new Error(`Rate limited (429) on ${url} after max retries.`); // Or return specific error object
                         }
                    }

                    // Other Client Errors (4xx) - Generally not retryable
                    if (status >= 400 && status < 500) {
                        console.error(`RDAPClient: Client Error ${status} for ${url}:`, responseData || axiosError.message);
                        if (responseData && typeof responseData === 'object') return responseData; // Return RDAP error
                         throw new Error(`Client Error ${status} for ${url}`); // Or return generic error object
                    }

                    // Server Errors (5xx) - Retryable
                    if (status >= 500 && status < 600) {
                        if (attempt < this.maxRetries) {
                            const waitTimeMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                            console.warn(`RDAPClient: Server Error (${status}) on ${url}. Retrying in ${waitTimeMs / 1000}s...`);
                            await delay(waitTimeMs);
                            return this._makeRequest(url, redirectCount, attempt + 1);
                        } else {
                            console.error(`RDAPClient: Server Error (${status}) on ${url} after ${attempt + 1} attempts.`);
                            if (responseData && typeof responseData === 'object') return responseData;
                            throw new Error(`Server Error ${status} on ${url} after max retries.`);
                        }
                    }
                     // Fallback for unexpected status codes
                     throw new Error(`Unhandled HTTP status ${status} for ${url}`);

                } else if (request) {
                    // Network error (no response received) - Retryable
                     if (attempt < this.maxRetries) {
                         const waitTimeMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                         console.warn(`RDAPClient: Network error for ${url}. Retrying in ${waitTimeMs / 1000}s... (${axiosError.code || axiosError.message})`);
                         await delay(waitTimeMs);
                         return this._makeRequest(url, redirectCount, attempt + 1);
                     } else {
                         throw new Error(`Network error for ${url} after ${attempt + 1} attempts: ${axiosError.message}`);
                     }
                }
             }

             // Non-Axios error or setup error
             console.error(`RDAPClient: Error during request setup or processing for ${url}:`, error);
             throw error; // Re-throw original error
        }
    }

    // --- Public Query Methods ---
    async queryDomain(domainName: string): Promise<RdapDomainResponse | RdapError> {
        try {
            const baseUrl = await this._findServerUrl(domainName, 'domain');
            if (!baseUrl) {
                return { errorCode: 404, title: "Bootstrap Failed", description: [`No RDAP server found for the TLD of ${domainName} in IANA bootstrap data.`] };
            }
            const queryUrl = new URL(`domain/${encodeURIComponent(domainName)}`, baseUrl).toString();
            const result = await this._makeRequest(queryUrl); // result is RdapQueryResult

            // Use type guards to ensure the correct type is returned
            if (isRdapDomainResponse(result) || isRdapError(result)) {
                return result; // Now TypeScript knows it's RdapDomainResponse or RdapError
            } else {
                // Handle unexpected response type from the server
                console.error(`RDAPClient: Unexpected response type received for domain query ${domainName}:`, result);
                return {
                    errorCode: 500, // Or a more specific code?
                    title: "Client Response Error",
                    description: ["Received unexpected object shape from RDAP server for a domain query."]
                };
            }

        } catch (error: any) {
            console.error(`RDAPClient: Failed to query domain ${domainName}:`, error.message);
             // Check if the caught error itself is already an RdapError structure from _makeRequest
             if (isRdapError(error)) {
                return error;
             }
             // Otherwise, return a generic client error
             return {
                errorCode: 500,
                title: "Client Query Error",
                description: [`Failed to process RDAP query for domain ${domainName}: ${error.message}`]
             };
        }
    }

     async queryIp(ipAddress: string): Promise<RdapIpNetworkResponse | RdapError> {
        try {
            if (!ipaddr.isValid(ipAddress)) {
                // Return an RdapError for invalid input directly
                 return {
                    errorCode: 400, // Bad Request
                    title: "Invalid Input",
                    description: [`Invalid IP address format provided: ${ipAddress}`]
                 };
            }
            const baseUrl = await this._findServerUrl(ipAddress, 'ip');
             if (!baseUrl) {
                return { errorCode: 404, title: "Bootstrap Failed", description: [`No RDAP server found for IP address ${ipAddress} in IANA bootstrap data.`] };
            }
            const queryUrl = new URL(`ip/${encodeURIComponent(ipAddress)}`, baseUrl).toString();
            const result = await this._makeRequest(queryUrl); // result is RdapQueryResult

            // Use type guards to ensure the correct type is returned
            if (isRdapIpNetworkResponse(result) || isRdapError(result)) {
                return result; // Now TypeScript knows it's RdapIpNetworkResponse or RdapError
            } else {
                 // Handle unexpected response type from the server
                 console.error(`RDAPClient: Unexpected response type received for IP query ${ipAddress}:`, result);
                 return {
                     errorCode: 500,
                     title: "Client Response Error",
                     description: ["Received unexpected object shape from RDAP server for an IP query."]
                 };
            }
        } catch (error: any) {
            console.error(`RDAPClient: Failed to query IP ${ipAddress}:`, error.message);
             // Check if the caught error itself is already an RdapError structure from _makeRequest
             if (isRdapError(error)) {
                return error;
             }
             // Otherwise, return a generic client error
             return {
                errorCode: 500,
                title: "Client Query Error",
                description: [`Failed to process RDAP query for IP ${ipAddress}: ${error.message}`]
             };
        }
    }
}

export const rdapClientInstance = new RDAPClient();