// app/search/page.tsx
"use client";

import { useState } from 'react';

// Define a type for the expected API response data (adjust based on your actual data)
type RdapResult = {
  // Example properties - replace with your actual Prisma model fields
  id: string;
  query: string;
  type: 'domain' | 'ip';
  data: any; // Or a more specific type for the RDAP JSON
  createdAt: string;
  updatedAt: string;
};

export default function Search() {
  const [searchTerm, setSearchTerm] = useState('');
  // --- New State Variables ---
  const [results, setResults] = useState<RdapResult | null>(null); // To store the fetched result
  const [isLoading, setIsLoading] = useState(false); // To show a loading indicator
  const [error, setError] = useState<string | null>(null); // To show error messages
  // --- End New State Variables ---

  const handleSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!searchTerm.trim()) { // Don't search if term is empty or just whitespace
        setError("Please enter an IP address or domain name.");
        setResults(null);
        return;
    }

    setIsLoading(true); // Set loading state to true
    setError(null);     // Clear previous errors
    setResults(null);   // Clear previous results

    try {
      // Construct the API URL with the search term as a query parameter
      const apiUrl = `/api/rdap?query=${encodeURIComponent(searchTerm.trim())}`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        // Handle HTTP errors (e.g., 404 Not Found, 500 Internal Server Error)
        const errorData = await response.json().catch(() => ({ message: 'An error occurred' })); // Try to parse error JSON
        throw new Error(errorData.message || `HTTP error! Status: ${response.status}`);
      }

      const data: RdapResult = await response.json(); // Parse the JSON response
      setResults(data); // Update the results state

    } catch (err) {
      console.error("Search failed:", err);
      // Set error state - check if err is an Error object
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred during the search.');
      }
      setResults(null); // Ensure results are cleared on error
    } finally {
      setIsLoading(false); // Set loading state back to false, regardless of success/error
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
    // Optionally clear error/results when user starts typing again
    if (error) setError(null);
    if (results) setResults(null);
  };

  return (
    <div className="p-8 font-[family-name:var(--font-geist-sans)]">
      <h1 className="text-2xl font-semibold mb-6 text-center">Search RDAP Cache</h1>

      <form onSubmit={handleSearch} className="max-w-xl mx-auto flex gap-2">
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

      {/* --- Display Area --- */}
      <div className="mt-10 max-w-2xl mx-auto">
        {/* Loading Indicator */}
        {isLoading && (
          <div className="text-center text-gray-500">Loading...</div>
        )}

        {/* Error Message */}
        {error && (
          <div className="text-center text-red-600 bg-red-100 border border-red-400 rounded p-3">
            Error: {error}
          </div>
        )}

        {/* Results Display */}
        {results && !isLoading && !error && (
          <div className="bg-white shadow-md rounded p-6 border border-gray-200">
            <h2 className="text-xl font-semibold mb-4">Result for: {results.query}</h2>
            <pre className="bg-gray-50 p-4 rounded overflow-x-auto text-sm">
              {/* Display the raw RDAP data nicely formatted */}
              {JSON.stringify(results.data, null, 2)}
            </pre>
            <p className="text-xs text-gray-500 mt-4">Type: {results.type}</p>
            <p className="text-xs text-gray-500">Cached At: {new Date(results.updatedAt).toLocaleString()}</p>
          </div>
        )}
         {/* Initial state / No search yet */}
         {!isLoading && !error && !results && !searchTerm && (
             <p className="text-center text-gray-500">Enter an IP or domain to search.</p>
         )}
      </div>
      {/* --- End Display Area --- */}
    </div>
  );
}