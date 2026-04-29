import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getShopForHost } from "@/lib/shop";

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

        const hostHeader =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((req?.headers as any)?.["x-forwarded-host"] as string | undefined) ??
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((req?.headers as any)?.host as string | undefined) ??
          null;

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
      }
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
