import Link from 'next/link';

const Navbar = () => {
  return (
    <nav className="bg-blue-600 text-white shadow-md">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <Link href="/" className="text-xl font-semibold hover:text-blue-200">
          RDAP Cache Service
        </Link>
        <div>
          <Link href="/" className="px-3 hover:text-blue-200">
            Home
          </Link>
          <Link href="/rdap" className="px-3 hover:text-blue-200">
            RDAP Lookup
          </Link>          
          <Link href="/dns" className="px-3 hover:text-blue-200">
            DNS Lookup
          </Link>          
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
