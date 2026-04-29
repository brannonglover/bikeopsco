import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      shopId: string;
      shopSubdomain: string;
      name?: string | null;
      image?: string | null;
    };
  }

  interface User {
    shopId: string;
    shopSubdomain: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    email?: string;
    shopId?: string;
    shopSubdomain?: string;
  }
}
