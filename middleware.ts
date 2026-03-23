import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    /*
     * Protect staff routes. Public: login, pay, status, chat/c, api/auth, webhooks, jobs, chat, cron
     */
    "/((?!_next|favicon|login|pay|status|chat/c|api/auth|api/webhooks|api/jobs|api/chat|api/cron).*)",
  ],
};
