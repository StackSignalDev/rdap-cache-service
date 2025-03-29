import axios, { AxiosInstance, AxiosError } from 'axios';
import { URL } from 'url';
import ipaddr from 'ipaddr.js';
import {
  BootstrapCache,
  BootstrapData,
  BootstrapServiceEntry,
  isRdapDomainResponse,
  isRdapError,
  isRdapIpNetworkResponse,
  RdapDomainResponse,
  RdapError,
  RdapIpNetworkResponse,
  RdapQueryResult,
} from './types';

const IANA_BOOTSTRAP_URLS = {
  domain: 'https://data.iana.org/rdap/dns.json',
  ipv4: 'https://data.iana.org/rdap/ipv4.json',
  ipv6: 'https://data.iana.org/rdap/ipv6.json',
};

const DEFAULT_USER_AGENT = 'RDAPCache/1.0 (Node.js)';
const DEFAULT_TIMEOUT = 10000;
const MAX_REDIRECTS = 5;
const MAX_RETRIES = 2;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class RDAPClient {
  private axiosInstance: AxiosInstance;
  private userAgent: string;
  private timeout: number;
  private maxRedirects: number;
  private maxRetries: number;
  private bootstrapCache: BootstrapCache = {
    domain: null,
    ipv4: null,
    ipv6: null,
    lastUpdated: null,
  };
  private bootstrapLoadingPromise: Promise<BootstrapCache> | null = null;

  constructor(
    options: {
      userAgent?: string;
      timeout?: number;
      maxRedirects?: number;
      maxRetries?: number;
    } = {}
  ) {
    this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.maxRedirects = options.maxRedirects || MAX_REDIRECTS;
    this.maxRetries = options.maxRetries || MAX_RETRIES;

    this.axiosInstance = axios.create({
      timeout: this.timeout,
      headers: {
        Accept: 'application/rdap+json',
        'User-Agent': this.userAgent,
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    this.ensureBootstrapData().catch((err) => {
      console.error('Initial background bootstrap load failed:', err.message);
    });
  }

  private async _fetchBootstrapFile(url: string): Promise<BootstrapData> {
    console.log(`Fetching bootstrap data from ${url}...`);

    const rawResponse = await axios.get<string>(url, {
      timeout: this.timeout,
      transformResponse: [(data) => data],
    });

    console.log(
      `Fetched ${url}. Status: ${rawResponse.status}. Size: ${rawResponse.data.length} bytes.`
    );

    try {
      const jsonData: BootstrapData = JSON.parse(rawResponse.data);
      if (
        rawResponse.status === 200 &&
        jsonData?.services &&
        jsonData?.version
      ) {
        if (url === IANA_BOOTSTRAP_URLS.domain) {
          console.log(
            `Parsed ${jsonData.services.length} domain services from ${url}.`
          );
        }
        return jsonData;
      }
      throw new Error(
        `Parsed data missing 'services' or 'version' field from ${url}`
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (parseError: any) {
      console.error(`Failed to parse JSON from ${url}: ${parseError.message}`);
      throw new Error(`Failed to parse JSON from ${url}`);
    }
  }

  async ensureBootstrapData(forceRefresh = false): Promise<BootstrapCache> {
    if (this.bootstrapCache.lastUpdated && !forceRefresh) {
      const now = new Date();
      const ageHours =
        (now.getTime() - this.bootstrapCache.lastUpdated.getTime()) /
        (1000 * 60 * 60);
      if (ageHours < 24) {
        return this.bootstrapCache;
      } else {
        console.log(
          'Bootstrap data is older than 24 hours, initiating refresh.'
        );
        forceRefresh = true;
      }
    }

    if (this.bootstrapLoadingPromise) {
      return this.bootstrapLoadingPromise;
    }

    if (!this.bootstrapCache.lastUpdated || forceRefresh) {
      this.bootstrapLoadingPromise = (async () => {
        try {
          console.log('Loading/Refreshing IANA Bootstrap Data...');
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
          console.log('Bootstrap data loaded/refreshed successfully.');
          return this.bootstrapCache;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          console.error('Failed to load bootstrap data:', error.message);
          throw new Error(
            `Failed to initialize/refresh bootstrap data: ${error.message}`
          );
        } finally {
          this.bootstrapLoadingPromise = null;
        }
      })();
      return this.bootstrapLoadingPromise;
    } else {
      return Promise.resolve(this.bootstrapCache);
    }
  }

  private async _findServerUrl(
    query: string,
    queryType: 'domain' | 'ip'
  ): Promise<string | null> {
    const bootstrap = await this.ensureBootstrapData();
    if (!bootstrap.lastUpdated) {
      throw new Error('Bootstrap data is not available.');
    }

    let services: BootstrapServiceEntry[] | undefined;
    let matchKey: string | undefined;
    let baseUrls: string[] | undefined;

    try {
      switch (queryType) {
        case 'domain':
          services = bootstrap.domain?.services;
          if (!services) {
            console.error(
              'DEBUG: Breaking because services is null/undefined for domain'
            );
            break;
          }
          const labels = query.toLowerCase().split('.');

          for (let i = 0; i < labels.length; i++) {
            const tld = labels.slice(i).join('.');
            console.log(`DEBUG: Checking TLD: ${tld}`);

            const entry = services.find((service) => service[0].includes(tld));

            if (entry) {
              matchKey = tld;
              baseUrls = entry[1];
              console.log(
                `DEBUG: Found match for ${tld}! Base URLs: ${baseUrls}`
              );
              break;
            }
          }
          if (!baseUrls) {
            console.log(
              `DEBUG: No match found after checking all labels for ${query}`
            );
          }
          break;

        case 'ip':
          let addr: ipaddr.IPv4 | ipaddr.IPv6 | null = null;
          try {
            addr = ipaddr.parse(query);
            services =
              addr.kind() === 'ipv6'
                ? bootstrap.ipv6?.services
                : bootstrap.ipv4?.services;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (e: any) {
            console.log(`DEBUG: Failed to parse IP address ${query}: ${e.message}`)
            throw new Error(`Invalid IP address format: ${query}`);
          }
          if (!services) {
            console.error(
              `DEBUG: Breaking because IP services are null/undefined for ${addr.kind()}`
            );
            break;
          }

          const entryIp = services.find((service) => {
            return service[0].some((cidrStr) => {
              try {
                const range = ipaddr.parseCIDR(cidrStr);
                return addr!.match(range);
              } catch (e) {
                console.log(
                  `DEBUG: Failed to parse CIDR ${cidrStr} for IP ${query}: ${e}`)
                return false;
              }
            });
          });
          if (entryIp) {
            matchKey = query;
            baseUrls = entryIp[1];
            console.log(
              `DEBUG: Found IP match for ${query}! Base URLs: ${baseUrls}`
            );
          } else {
            console.log(`DEBUG: No matching IP range found for ${query}`);
          }
          break;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (parseError: any) {
      console.error(
        `Error processing bootstrap lookup for '${query}' (${queryType}): ${parseError.message}`
      );
      throw parseError;
    }

    if (!baseUrls || baseUrls.length === 0) {
      console.warn(
        `No RDAP bootstrap server found for ${queryType} ${matchKey || query}`
      );
      return null;
    }

    const httpsUrl = baseUrls.find((url) =>
      url.toLowerCase().startsWith('https://')
    );
    if (httpsUrl) return httpsUrl;

    const httpUrl = baseUrls.find((url) =>
      url.toLowerCase().startsWith('http://')
    );
    if (httpUrl) {
      console.warn(`Using non-HTTPS RDAP URL: ${httpUrl}`);
      return httpUrl;
    }

    console.error(
      `No suitable HTTPS or HTTP URL found in bootstrap entry for ${queryType} ${matchKey || query}`
    );
    return null;
  }

  private async _makeRequest(
    url: string,
    redirectCount = 0,
    attempt = 0
  ): Promise<RdapQueryResult> {
    if (redirectCount > this.maxRedirects) {
      return {
        errorCode: 508,
        title: 'Too Many Redirects',
        description: [
          `Exceeded maximum redirect limit (${this.maxRedirects}) fetching ${url}`,
        ],
      };
    }

    console.log(
      `RDAPClient: Attempt ${attempt + 1}/${this.maxRetries + 1}: Requesting ${url}`
    );

    try {
      const response = await this.axiosInstance.get<RdapQueryResult>(url);

      if (response.headers['content-type']?.includes('application/rdap+json')) {
        return response.data;
      } else {
        console.warn(
          `RDAP server returned success status but unexpected Content-Type: ${response.headers['content-type']} for ${url}`
        );

        return response.data;
      }      
    } catch (error) {
      if (axios.isAxiosError(error)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const axiosError = error as AxiosError<any>;
        const response = axiosError.response;
        const request = axiosError.request;

        if (response) {
          const status = response.status;
          const headers = response.headers;
          const responseData = response.data;

          if (status >= 300 && status < 400 && headers.location) {
            const location = headers.location;
            console.log(
              `RDAPClient: Following redirect (${status}) from ${url} to ${location}`
            );
            try {
              const nextUrl = new URL(location, url).toString();
              return this._makeRequest(nextUrl, redirectCount + 1, 0);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (urlError: any) {
              console.error(
                `RDAPClient: Invalid redirect URL "${location}" received from ${url}: ${urlError.message}`
              );
              return {
                errorCode: 502,
                title: 'Bad Gateway',
                description: [
                  `Invalid redirect URL received from upstream RDAP server: ${location}`,
                ],
              };
            }
          }

          if (status === 404) {
            console.log(`RDAPClient: RDAP Not Found (404) for ${url}`);

            if (
              responseData &&
              typeof responseData === 'object' &&
              responseData.errorCode
            )
              return responseData as RdapError;
            return {
              errorCode: 404,
              title: 'Not Found',
              description: [
                'The RDAP server could not find the requested resource.',
              ],
            };
          }

          if (status === 429) {
            if (attempt < this.maxRetries) {
              const retryAfterHeader = headers['retry-after'];
              const retryAfterSec =
                typeof retryAfterHeader === 'string'
                  ? parseInt(retryAfterHeader, 10)
                  : NaN;
              const waitTimeMs = isNaN(retryAfterSec)
                ? Math.pow(2, attempt) * 1000 + Math.random() * 1000
                : retryAfterSec * 1000 + Math.random() * 500;
              console.warn(
                `RDAPClient: Rate limited (429) on ${url}. Retrying in ${waitTimeMs / 1000}s...`
              );
              await delay(waitTimeMs);
              return this._makeRequest(url, redirectCount, attempt + 1);
            } else {
              console.error(
                `RDAPClient: Rate limited (429) on ${url} after ${attempt + 1} attempts.`
              );

              if (
                responseData &&
                typeof responseData === 'object' &&
                responseData.errorCode
              )
                return responseData as RdapError;
              return {
                errorCode: 429,
                title: 'Too Many Requests',
                description: [`Rate limited on ${url} after max retries.`],
              };
            }
          }

          if (status >= 400 && status < 500) {
            console.error(
              `RDAPClient: Client Error ${status} for ${url}:`,
              responseData || axiosError.message
            );
            if (
              responseData &&
              typeof responseData === 'object' &&
              responseData.errorCode
            )
              return responseData as RdapError;

            return {
              errorCode: status,
              title: `Client Error: ${status}`,
              description: [
                `An error occurred while requesting ${url}.`,
                axiosError.message,
              ],
            };
          }

          if (status >= 500 && status < 600) {
            if (attempt < this.maxRetries) {
              const waitTimeMs =
                Math.pow(2, attempt) * 1000 + Math.random() * 1000;
              console.warn(
                `RDAPClient: Server Error (${status}) on ${url}. Retrying in ${waitTimeMs / 1000}s...`
              );
              await delay(waitTimeMs);
              return this._makeRequest(url, redirectCount, attempt + 1);
            } else {
              console.error(
                `RDAPClient: Server Error (${status}) on ${url} after ${attempt + 1} attempts.`
              );
              if (
                responseData &&
                typeof responseData === 'object' &&
                responseData.errorCode
              )
                return responseData as RdapError;
              return {
                errorCode: status,
                title: `Server Error: ${status}`,
                description: [
                  `Received server error from ${url} after max retries.`,
                ],
              };
            }
          }

          console.error(
            `RDAPClient: Unhandled HTTP status ${status} for ${url}:`,
            responseData || axiosError.message
          );
          return {
            errorCode: status,
            title: `Unhandled HTTP Status: ${status}`,
            description: [
              `Received an unexpected HTTP status code from ${url}.`,
            ],
          };
        } else if (request) {
          if (attempt < this.maxRetries) {
            const waitTimeMs =
              Math.pow(2, attempt) * 1000 + Math.random() * 1000;
            console.warn(
              `RDAPClient: Network error for ${url}. Retrying in ${waitTimeMs / 1000}s... (${axiosError.code || axiosError.message})`
            );
            await delay(waitTimeMs);
            return this._makeRequest(url, redirectCount, attempt + 1);
          } else {
            console.error(
              `RDAPClient: Network error for ${url} after ${attempt + 1} attempts: ${axiosError.message}`
            );
            return {
              errorCode: 504,
              title: 'Gateway Timeout',
              description: [
                `Network error connecting to ${url} after max retries: ${axiosError.message}`,
              ],
            };
          }
        } else {
          console.error(
            `RDAPClient: Error during request setup or processing for ${url}:`,
            error
          );
          return {
            errorCode: 500,
            title: 'Internal Client Error',
            description: [
              `An unexpected error occurred before the request could be sent to ${url}: ${error instanceof Error ? error.message : String(error)}`,
            ],
          };
        }
      } else {
        console.error(
          `RDAPClient: Non-Axios error during request processing for ${url}:`,
          error
        );
        return {
          errorCode: 500,
          title: 'Internal Client Error',
          description: [
            `An unexpected non-HTTP error occurred while processing the request for ${url}: ${error instanceof Error ? error.message : String(error)}`,
          ],
        };
      }
    }
  }

  async queryDomain(
    domainName: string
  ): Promise<RdapDomainResponse | RdapError> {
    try {
      const baseUrl = await this._findServerUrl(domainName, 'domain');
      if (!baseUrl) {
        return {
          errorCode: 404,
          title: 'Bootstrap Failed',
          description: [
            `No RDAP server found for the TLD of ${domainName} in IANA bootstrap data.`,
          ],
        };
      }
      const queryUrl = new URL(
        `domain/${encodeURIComponent(domainName)}`,
        baseUrl
      ).toString();
      const result = await this._makeRequest(queryUrl);

      if (isRdapDomainResponse(result) || isRdapError(result)) {
        return result;
      } else {
        console.error(
          `RDAPClient: Unexpected response type received for domain query ${domainName}:`,
          result
        );
        return {
          errorCode: 500,
          title: 'Client Response Error',
          description: [
            'Received unexpected object shape from RDAP server for a domain query.',
          ],
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(
        `RDAPClient: Failed to query domain ${domainName}:`,
        error.message
      );
      if (isRdapError(error)) {
        return error;
      }
      return {
        errorCode: 500,
        title: 'Client Query Error',
        description: [
          `Failed to process RDAP query for domain ${domainName}: ${error.message}`,
        ],
      };
    }
  }

  async queryIp(ipAddress: string): Promise<RdapIpNetworkResponse | RdapError> {
    try {
      // Validate IP format before bootstrap lookup (ipaddr.parse handles this in _findServerUrl now)
      // if (!ipaddr.isValid(ipAddress)) { // Keep validation maybe? Or rely on _findServerUrl's try/catch
      //      return { errorCode: 400, title: "Invalid Input", description: [`Invalid IP address format provided: ${ipAddress}`] };
      // }
      const baseUrl = await this._findServerUrl(ipAddress, 'ip');
      if (!baseUrl) {
        return {
          errorCode: 404,
          title: 'Bootstrap Failed',
          description: [
            `No RDAP server found for IP address ${ipAddress} in IANA bootstrap data.`,
          ],
        };
      }
      const queryUrl = new URL(
        `ip/${encodeURIComponent(ipAddress)}`,
        baseUrl
      ).toString();
      const result = await this._makeRequest(queryUrl);

      if (isRdapIpNetworkResponse(result) || isRdapError(result)) {
        return result;
      } else {
        console.error(
          `RDAPClient: Unexpected response type received for IP query ${ipAddress}:`,
          result
        );
        return {
          errorCode: 500,
          title: 'Client Response Error',
          description: [
            'Received unexpected object shape from RDAP server for an IP query.',
          ],
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(
        `RDAPClient: Failed to query IP ${ipAddress}:`,
        error.message
      );

      if (error.message?.startsWith('Invalid IP address format')) {
        return {
          errorCode: 400,
          title: 'Invalid Input',
          description: [error.message],
        };
      }
      if (isRdapError(error)) {
        return error;
      }
      return {
        errorCode: 500,
        title: 'Client Query Error',
        description: [
          `Failed to process RDAP query for IP ${ipAddress}: ${error.message}`,
        ],
      };
    }
  }
}

export const rdapClientInstance = new RDAPClient();
