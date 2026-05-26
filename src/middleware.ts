import { withAuth } from "next-auth/middleware";

/**
 * Only /admin/* requires authentication. The public monitoring routes
 * (/, /servers/[id]) are intentionally open.
 */
export default withAuth(
  function middleware() {
    // No-op: presence of token (validated below) is enough.
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  },
);

export const config = {
  matcher: ["/admin/:path*"],
};
