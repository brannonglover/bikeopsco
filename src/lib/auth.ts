import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getShopForHost } from "@/lib/shop";
import { resolveRequestHost } from "@/lib/request-host";
import { isSessionCurrent } from "@/lib/session-version";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        const hostHeader = resolveRequestHost(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (req?.headers as any)?.host as string | undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (req?.headers as any)?.["x-forwarded-host"] as string | undefined
        );

        const shop = await getShopForHost(hostHeader);
        if (!shop) return null;

        const user = await prisma.user.findUnique({
          where: {
            shopId_email: {
              shopId: shop.id,
              email: credentials.email.trim().toLowerCase(),
            },
          },
        });

        if (!user || !(await bcrypt.compare(credentials.password, user.passwordHash))) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          shopId: shop.id,
          shopSubdomain: shop.subdomain,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email ?? undefined;
        token.shopId = user.shopId;
        token.shopSubdomain = user.shopSubdomain;
        token.sessionVersion = user.sessionVersion;
        return token;
      }
      // Every later read (getServerSession, /api/auth/session) re-checks the
      // version, so a password reset signs this browser out: throwing here
      // makes NextAuth clear the cookie, and AppShell sends the page to /login.
      // A database error keeps the session rather than signing everyone out on
      // a blip; API routes make the same check themselves and fail closed.
      let current = true;
      try {
        current = await isSessionCurrent(token);
      } catch (error) {
        console.error("[auth] Session version check failed:", error);
      }
      if (!current) throw new Error("Session revoked");
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.shopId = token.shopId as string;
        session.user.shopSubdomain = token.shopSubdomain as string;
      }
      return session;
    },
  },
};
