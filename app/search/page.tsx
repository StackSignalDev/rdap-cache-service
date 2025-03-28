
"use client";

import { useState } from 'react';

import { RdapDomainResponse, RdapIpNetworkResponse, RdapError } from '@/lib/types'; 


type ApiSuccessResponse = {
  rdapResponse: RdapDomainResponse | RdapIpNetworkResponse
  type: 'domain' | 'ip';
  cacheStatus: 'hit' | 'miss'; 
};

type ApiErrorResponse = RdapError & { message?: string };


const ClipboardIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
  </svg>
);


const CheckIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
  </svg>
);


export default function Search() {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<ApiSuccessResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | ApiErrorResponse | null>(null);
  const [cacheStatus, setCacheStatus] = useState<'hit' | 'miss' | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  const handleSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedSearchTerm = searchTerm.trim();
    if (!trimmedSearchTerm) {
      setError("Please enter an IP address or domain name.");
      setResults(null);
      setCacheStatus(null); 
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);
    setCacheStatus(null); 
    setCopyStatus('idle'); 

    try {
      const apiUrl = `/api/rdap?query=${encodeURIComponent(trimmedSearchTerm)}`;
      const response = await fetch(apiUrl);
      const responseData = await response.json().catch(() => ({
        message: `Request failed with status ${response.status}. Could not parse error response.`
      }));

      if (!response.ok) {
        throw responseData;
      }

      const data: ApiSuccessResponse = responseData;
      setResults(data);
      setCacheStatus(data.cacheStatus); 

    } catch (err: any) {
      console.error("Search failed:", err);
      if (typeof err === 'object' && err !== null && (err.errorCode || err.message)) {
        setError(err as ApiErrorResponse);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred during the search.');
      }
      setResults(null);
      setCacheStatus(null); 
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
    if (error) setError(null);
    if (results) setResults(null);
    if (cacheStatus) setCacheStatus(null); 
    setCopyStatus('idle'); 
  };

  
  const handleCopy = () => {
    if (!results || !navigator.clipboard) {
      console.warn('Cannot copy: No results or clipboard API unavailable.');
      return;
    }
    const jsonString = JSON.stringify(results, null, 2);
    navigator.clipboard.writeText(jsonString).then(() => {
      setCopyStatus('copied');
      
      setTimeout(() => setCopyStatus('idle'), 1000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
      
    });
  };
  

  const renderError = () => {
    
    if (!error) return null;
    let displayError: string;
    if (typeof error === 'string') {
      displayError = error;
    } else {
      
      displayError = `${error.title || 'Error'} (Code: ${error.errorCode || 'N/A'}): ${error.description?.join(' ') || error.message || 'No details available.'}`;
    }
    return (
      <div className="text-center text-red-600 bg-red-100 border border-red-400 rounded p-3">
        Error: {displayError}
      </div>
    );
  };


  return (
    <div className="p-8 font-[family-name:var(--font-geist-sans)]">
      <h1 className="text-2xl font-semibold mb-6 text-center">Search RDAP Cache</h1>

      <form onSubmit={handleSearch} className="max-w-xl mx-auto flex gap-2">
        {/* ... (Input and Button remain the same) ... */}
        <label htmlFor="search-input" className="sr-only">
          Search IP or Domain
        </label>
        <input
          id="search-input"
          type="search"
          placeholder="Enter IP address or domain name..."
          className="flex-grow px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          value={searchTerm}
          onChange={handleInputChange}
          disabled={isLoading} 
        />
        <button
          type="submit"
          className={`px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          disabled={isLoading} 
        >
          {isLoading ? 'Searching...' : 'Search'} {/* Show loading text */}
        </button>
      </form>

      <div className="mt-10 max-w-4xl mx-auto">
        {isLoading && (
          <div className="text-center text-gray-500">Loading...</div>
        )}

        {renderError()}

        {/* --- Updated Results Display --- */}
        {results && !isLoading && !error && (
          <div className="bg-white shadow-md rounded p-6 border border-gray-200 relative"> {/* Added relative positioning */}
            <div className="flex justify-between items-start">
              <h2 className="text-xl font-semibold">Result for: {searchTerm.trim()}</h2>
              <div className="text-small text-gray-700">Type: {results.type}</div>
              {cacheStatus && (
                <span className={`text-xs font-medium px-5 py-0.5 rounded ${cacheStatus === 'hit' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                  {cacheStatus === 'hit' ? 'Cached' : 'Live'}
                </span>
              )}

              {copyStatus === 'copied' ? (
                <CheckIcon className="w-5 h-5 text-green-600" />
              ) : (
                <button
                  onClick={handleCopy}
                  title="Copy JSON to clipboard"
                  className="text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-md"
                  aria-label="Copy JSON to clipboard"
                >
                  <ClipboardIcon className="w-5 h-5" />
                </button>
              )}
            </div>


            <pre className="bg-gray-100 p-4 rounded overflow-x-auto text-sm border mt-2"> {/* Added mt-2 */}
              {JSON.stringify(results.rdapResponse, null, 2)}
            </pre>
          </div>
        )}
        {/* --- End Updated Results Display --- */}

        {!isLoading && !error && !results && (
          <p className="text-center text-gray-500 pt-4">
            {searchTerm ? 'No results found.' : 'Enter an IP or domain to search.'}
          </p>
        )}
      </div>
    </div>
  );
}