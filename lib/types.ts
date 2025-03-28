export interface RdapLink {
    value: string;
    rel: string;
    href: string;
    type: string;
}

export interface RdapNotice {
    title: string;
    description: string[];
    links?: RdapLink[];
}

export interface RdapBaseResponse {
    rdapConformance?: string[];
    notices?: RdapNotice[];
    links?: RdapLink[];
    // ... other common properties
}

export interface RdapDomainResponse extends RdapBaseResponse {
    objectClassName: "domain";
    ldhName: string; // Lowercase LDH form
    unicodeName?: string; // Optional Unicode form
    nameservers?: any[]; // Define Nameserver type
    entities?: any[]; // Define Entity type
    status?: string[];
    events?: any[]; // Define Event type
    // ... other domain-specific properties
}

export interface RdapIpNetworkResponse extends RdapBaseResponse {
    objectClassName: "ip network";
    handle: string;
    startAddress: string;
    endAddress: string;
    ipVersion: "v4" | "v6";
    name?: string;
    type?: string; // e.g., "ASSIGNED", "ALLOCATED"
    country?: string;
    cidr?: string; // Often present in nested networks
    entities?: any[]; // Define Entity type
    status?: string[];
    events?: any[]; // Define Event type
    // ... other IP-specific properties
}

// Define a type for RDAP error responses (based on RFC 7480)
export type RdapError = {
    errorCode: number;
    title?: string;
    description: string[];
    [key: string]: any; // Allow other properties
};

export type RdapQueryResult = RdapDomainResponse | RdapIpNetworkResponse | RdapError;

// Define types for Bootstrap data (can be refined)
export type BootstrapServiceEntry = [string[], string[]]; // [ ["tld1", "tld2"], ["url1", "url2"] ] or [ ["cidr1", "cidr2"], ["url1"] ] etc.
export type BootstrapData = {
    version: string;
    publication: string;
    services: BootstrapServiceEntry[];
};
export type BootstrapCache = {
    domain: BootstrapData | null;
    ipv4: BootstrapData | null;
    ipv6: BootstrapData | null;
    lastUpdated: Date | null;
};

// --- Helper Type Guards ---
export function isRdapError(obj: any): obj is RdapError {
    return typeof obj === 'object' && obj !== null && typeof obj.errorCode === 'number' && Array.isArray(obj.description);
}

export function isRdapDomainResponse(obj: any): obj is RdapDomainResponse {
    return typeof obj === 'object' && obj !== null && obj.objectClassName === 'domain';
}

export function isRdapIpNetworkResponse(obj: any): obj is RdapIpNetworkResponse {
    return typeof obj === 'object' && obj !== null && obj.objectClassName === 'ip network';
}
// --- End Helper Type Guards ---