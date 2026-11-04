import { Link, Outlet } from 'react-router';

import { BrandingLogo } from '~/components/general/branding-logo';
import { SiteFooter } from '~/components/general/site-footer';

export default function Layout() {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 md:py-16">
        <Link
          to="/"
          className="mb-8 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <BrandingLogo className="h-8 w-auto" />
        </Link>

        <div className="relative flex w-full flex-col items-center">
          <Outlet />
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
