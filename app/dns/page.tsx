'use client';

import { useState } from 'react';

// --- Define API Response/Error Types for DNS ---
type DnsApiResponse = {
  domainName: string; // The validated domain name from the API
  cacheStatus: 'hit' | 'miss';
  aRecords: string[];
  aaaaRecords: string[];
};

// Matches the error structure the /api/dns route might return
type DnsApiError = {
  message: string; // General message (e.g., "Internal Server Error...")
  error?: string;   // More specific error details (e.g., from DNS lookup)
  errors?: { domainName?: string[] }; // Zod validation errors
};


// --- Icons (copied from RDAP page) ---
const ClipboardIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>
);

const CheckIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
);


export default function DnsLookupPage() {
  const [searchTerm, setSearchTerm] = useState('');
  // State to hold the structured DNS API response
  const [results, setResults] = useState<DnsApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // State to hold potential error messages or objects
  const [error, setError] = useState<string | DnsApiError | null>(null);
  // Cache status derived from results, could be removed if only read from results
  const [cacheStatus, setCacheStatus] = useState<'hit' | 'miss' | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  const handleSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedSearchTerm = searchTerm.trim();
    if (!trimmedSearchTerm) {
      setError('Please enter a domain name.');
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
      // Use the /api/dns endpoint and domainName parameter
      const apiUrl = `/api/dns?domainName=${encodeURIComponent(trimmedSearchTerm)}`;
      console.log(`Fetching: ${apiUrl}`); // Log the URL being fetched

      const response = await fetch(apiUrl);
      const responseData = await response.json().catch(() => {
          console.error("Failed to parse JSON response.");
          // Provide a default error structure if JSON parsing fails
          return { message: `Request failed with status ${response.status}. Invalid JSON response.` };
      });

      if (!response.ok) {
        // Throw the parsed error data (or the default error if parsing failed)
        throw responseData;
      }

      // Assert the structure matches DnsApiResponse
      const data: DnsApiResponse = responseData;
      setResults(data);
      setCacheStatus(data.cacheStatus); // Set cache status from the response
      console.log("API Success:", data);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error('DNS Search failed:', err);
      // Handle errors, trying to match DnsApiError structure
      if (typeof err === 'object' && err !== null && (err.message || err.errors)) {
        setError(err as DnsApiError); // Assume it matches DnsApiError
      } else if (err instanceof Error) {
        setError(err.message); // Fallback to generic error message
      } else if (typeof err === 'string') {
          setError(err); // Handle plain string errors
      }
       else {
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
    // Reset states when input changes
    if (error) setError(null);
    if (results) setResults(null);
    if (cacheStatus) setCacheStatus(null);
    setCopyStatus('idle');
  };

  // Copy the results object (containing A/AAAA records) as JSON
  const handleCopy = () => {
    if (!results || !navigator.clipboard) {
      console.warn('Cannot copy: No results or clipboard API unavailable.');
      return;
    }
    // Stringify the entire results object for copying
    const jsonString = JSON.stringify(results, null, 2);
    navigator.clipboard
      .writeText(jsonString)
      .then(() => {
        setCopyStatus('copied');
        setTimeout(() => setCopyStatus('idle'), 1000); // Reset icon after 1 second
      })
      .catch((err) => {
        console.error('Failed to copy text: ', err);
        // Optionally show a user-facing error message here
      });
  };

  // Render error messages, adapted for DnsApiError structure
  const renderError = () => {
    if (!error) return null;

    let displayError: string;
    if (typeof error === 'string') {
      displayError = error;
    } else {
        // Prioritize Zod validation errors if present
        if (error.errors?.domainName) {
            displayError = `Invalid Input: ${error.errors.domainName.join(', ')}`;
        }
        // Otherwise use message and optional details
        else {
             displayError = `${error.message}${error.error ? ` (${error.error})` : ''}`;
        }
    }

    return (
      <div className="text-center text-red-600 bg-red-100 border border-red-400 rounded p-3 mt-4 mb-4"> {/* Added margin */}
        Error: {displayError}
      </div>
    );
  };

  return (
    <div className="p-8 font-[family-name:var(--font-geist-sans)]">
      <h1 className="text-2xl font-semibold mb-6 text-center">
        Lookup A/AAAA DNS Records
      </h1>

      <form onSubmit={handleSearch} className="max-w-xl mx-auto flex gap-2">
        <label htmlFor="search-input" className="sr-only">
          Search Domain Name
        </label>
        <input
          id="search-input"
          type="search"
          // Update placeholder
          placeholder="Enter domain name (e.g., example.com)..."
          className="flex-grow px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          value={searchTerm}
          onChange={handleInputChange}
          disabled={isLoading}
          aria-label="Domain name input"
        />
        <button
          type="submit"
          className={`px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          disabled={isLoading}
        >
          {isLoading ? 'Looking up...' : 'Lookup'}
        </button>
      </form>

      <div className="mt-10 max-w-4xl mx-auto">
        {isLoading && (
          <div className="text-center text-gray-500">Loading...</div>
        )}

        {renderError()} {/* Ensure error renders outside the results block */}

        {/* --- Updated Results Display for DNS --- */}
        {results && !isLoading && !error && (
          <div className="bg-white shadow-md rounded p-6 border border-gray-200 relative">
            <div className="flex justify-between items-center mb-4"> {/* Adjusted alignment and margin */}
                {/* Display the validated domain name from the API response */}
              <h2 className="text-xl font-semibold">
                Results for: {results.domainName}
              </h2>
                <div className="flex items-center gap-3"> {/* Group status/copy */}
                    {cacheStatus && (
                        <span
                        className={`text-xs font-medium px-2.5 py-0.5 rounded ${ // Adjusted padding
                            cacheStatus === 'hit'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                        >
                        {cacheStatus === 'hit' ? 'Cached' : 'Live'}
                        </span>
                    )}

                    {copyStatus === 'copied' ? (
                        <CheckIcon className="w-5 h-5 text-green-600" />
                    ) : (
                        <button
                        onClick={handleCopy}
                        title="Copy results as JSON"
                        className="text-gray-500 hover:text-gray-800 p-1 hover:bg-gray-100 rounded-md" // Added padding
                        aria-label="Copy results as JSON"
                        >
                        <ClipboardIcon className="w-5 h-5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Section for A Records */}
            <div className="mb-4">
                <h3 className="text-lg font-medium mb-2 border-b pb-1">A Records (IPv4)</h3>
                {results.aRecords.length > 0 ? (
                    <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
                        {results.aRecords.map((ip, index) => (
                            <li key={`a-${index}`}>{ip}</li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-gray-500 italic">No A records found.</p>
                )}
            </div>

            {/* Section for AAAA Records */}
            <div>
                <h3 className="text-lg font-medium mb-2 border-b pb-1">AAAA Records (IPv6)</h3>
                 {results.aaaaRecords.length > 0 ? (
                     <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
                         {results.aaaaRecords.map((ip, index) => (
                             <li key={`aaaa-${index}`}>{ip}</li>
                         ))}
                    </ul>
                 ) : (
                    <p className="text-sm text-gray-500 italic">No AAAA records found.</p>
                 )}
            </div>

             {/* Optional: Show raw JSON if needed for debugging */}
             {/* <details className="mt-4">
                <summary className="cursor-pointer text-xs text-gray-500">Show JSON</summary>
                 <pre className="bg-gray-100 p-4 rounded overflow-x-auto text-xs border mt-2">
                    {JSON.stringify(results, null, 2)}
                </pre>
             </details> */}
          </div>
        )}
        {/* --- End Updated Results Display --- */}

        {/* Initial/No Results Message */}
        {!isLoading && !error && !results && (
          <p className="text-center text-gray-500 pt-4">
            Enter a domain name to look up its A and AAAA records.
          </p>
        )}
      </div>
    </div>
  );
}