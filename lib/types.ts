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
}

export interface RdapDomainResponse extends RdapBaseResponse {
  objectClassName: 'domain';
  ldhName: string;
  unicodeName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nameservers?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities?: any[];
  status?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events?: any[];
}

export interface RdapIpNetworkResponse extends RdapBaseResponse {
  objectClassName: 'ip network';
  handle: string;
  startAddress: string;
  endAddress: string;
  ipVersion: 'v4' | 'v6';
  name?: string;
  type?: string;
  country?: string;
  cidr?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cidr0_cidrs?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities?: any[];
  status?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events?: any[];
}

export type RdapError = {
  errorCode: number;
  title?: string;
  description: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

export type RdapQueryResult =
  | RdapDomainResponse
  | RdapIpNetworkResponse
  | RdapError;

export type BootstrapServiceEntry = [string[], string[]];

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isRdapError(obj: any): obj is RdapError {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.errorCode === 'number' &&
    Array.isArray(obj.description)
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isRdapDomainResponse(obj: any): obj is RdapDomainResponse {
  return (
    typeof obj === 'object' && obj !== null && obj.objectClassName === 'domain'
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isRdapIpNetworkResponse(obj: any): obj is RdapIpNetworkResponse {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    obj.objectClassName === 'ip network'
  );
}
