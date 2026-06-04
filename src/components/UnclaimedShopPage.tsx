import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "bikeops.co";

type UnclaimedShopPageProps = {
  subdomain: string;
};

export function UnclaimedShopPage({ subdomain }: UnclaimedShopPageProps) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-mesh p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="mb-5 flex h-28 items-center justify-center sm:h-32">
          <BrandLogo width={640} height={320} className="h-28 w-auto max-w-full object-contain sm:h-32" priority />
        </div>
        <h1 className="mb-2 text-center text-xl font-semibold text-slate-900">This workspace isn&apos;t set up yet</h1>
        <p className="mb-6 text-center text-sm leading-6 text-slate-600">
          <span className="font-medium text-slate-800">
            {subdomain}.{ROOT_DOMAIN}
          </span>{" "}
          hasn&apos;t been claimed. Create a shop to use this address, or try a different subdomain.
        </p>
        <Link
          href="/signup"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-700 px-4 py-3 font-semibold text-white hover:bg-slate-800"
        >
          Create a shop
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <p className="mt-5 text-center text-sm text-slate-600">
          Already have a shop?{" "}
          <Link href={`https://app.${ROOT_DOMAIN}/login`} className="font-semibold text-slate-900 hover:underline">
            Find your workspace
          </Link>
        </p>
      </div>
    </div>
  );
}
