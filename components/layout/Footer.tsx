import Image from 'next/image';

const Footer = () => {
  return (
    <footer className="bg-gray-200 text-gray-600 text-center p-4 mt-auto">
      <div>© {new Date().getFullYear()} StackSignalDev. All rights reserved.</div>
      <div>
      <a href="https://github.com/StackSignalDev/rdap-cache-service/fork" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center mt-2">
          <Image src="git-fork.svg" alt="Fork me on GitHub" width="40" height="40" />
          Fork me on GitHub
      </a>
      </div>
    </footer>
  );
};

export default Footer;
