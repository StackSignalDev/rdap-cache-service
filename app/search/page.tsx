// app/search/page.tsx
"use client";

import { useState } from 'react';
// Import the actual RDAP response types and RdapError from your types file
import { RdapDomainResponse, RdapIpNetworkResponse, RdapError } from '@/lib/types'; // Adjust path if needed

// Type for the successful API response (RDAP data + the 'type' field added by the API)
type ApiSuccessResponse = (RdapDomainResponse | RdapIpNetworkResponse) & { type: 'domain' | 'ip' };

// Type for the API error response (Matches RdapError structure, potentially with a generic message)
type ApiErrorResponse = RdapError & { message?: string }; // message for non-RDAP errors

export default function Search() {
  const [searchTerm, setSearchTerm] = useState('');
  // --- Use the corrected types for state ---
  const [results, setResults] = useState<ApiSuccessResponse | null>(null); // Store the successful RDAP response + type
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | ApiErrorResponse | null>(null); // Can store string or the error object
  // --- End State Variables ---

  const handleSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedSearchTerm = searchTerm.trim(); // Use a trimmed version
    if (!trimmedSearchTerm) {
        setError("Please enter an IP address or domain name.");
        setResults(null);
        return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);

    try {
      const apiUrl = `/api/rdap?query=${encodeURIComponent(trimmedSearchTerm)}`;
      const response = await fetch(apiUrl);

      // Try to parse JSON regardless of response.ok to get error details
      const responseData = await response.json().catch(() => ({
           message: `Request failed with status ${response.status}. Could not parse error response.`
      }));

      if (!response.ok) {
        // Throw the parsed error data or a generic message
        throw responseData; // Throw the parsed JSON error (likely ApiErrorResponse)
      }

      // --- Success: Assert the correct type ---
      const data: ApiSuccessResponse = responseData;
      setResults(data);

    } catch (err: any) { // Catch 'any' and then check its type
      console.error("Search failed:", err);
      // Set error state - store the object if it looks like ApiErrorResponse, otherwise store message
      if (typeof err === 'object' && err !== null && (err.errorCode || err.message)) {
           setError(err as ApiErrorResponse); // Store the error object
      } else if (err instanceof Error) {
        setError(err.message); // Store just the message string
      } else {
        setError('An unknown error occurred during the search.');
      }
      setResults(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
    if (error) setError(null);
    if (results) setResults(null);
  };

  // Helper to render error messages more informatively
  const renderError = () => {
    if (!error) return null;
    let displayError: string;
    if (typeof error === 'string') {
        displayError = error;
    } else {
        // Format the ApiErrorResponse object
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
          disabled={isLoading} // Disable input while loading
        />
        <button
          type="submit"
          className={`px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          disabled={isLoading} // Disable button while loading
        >
          {isLoading ? 'Searching...' : 'Search'} {/* Show loading text */}
        </button>
      </form>

      <div className="mt-10 max-w-4xl mx-auto"> {/* Increased max-width for results */}
        {isLoading && (
          <div className="text-center text-gray-500">Loading...</div>
        )}

        {/* Use the renderError helper */}
        {renderError()}

        {/* --- Corrected Results Display --- */}
        {results && !isLoading && !error && (
          <div className="bg-white shadow-md rounded p-6 border border-gray-200">
            {/* Use searchTerm from state, as API doesn't return it */}
            <h2 className="text-xl font-semibold mb-4">Result for: {searchTerm.trim()}</h2>
            <pre className="bg-gray-100 p-4 rounded overflow-x-auto text-sm border">
              {/* Display the entire 'results' object (which is the RDAP data + type) */}
              {JSON.stringify(results, null, 2)}
            </pre>
            {/* Display the 'type' field which IS returned by the API */}
            <p className="text-xs text-gray-500 mt-4">Type: {results.type}</p>
            {/* Removed 'Cached At' as it's not returned by the API */}
          </div>
        )}
        {/* --- End Corrected Results Display --- */}

         {!isLoading && !error && !results && (
             <p className="text-center text-gray-500 pt-4">
                {searchTerm ? 'No results found.' : 'Enter an IP or domain to search.'}
             </p>
         )}
      </div>
    </div>
  );
}