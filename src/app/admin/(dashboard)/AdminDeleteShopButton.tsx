"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";

const DEFAULT_SHOP_ID = "shop_default";

type AdminDeleteShopButtonProps = {
  shopId: string;
  shopName: string;
};

export function AdminDeleteShopButton({ shopId, shopName }: AdminDeleteShopButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (shopId === DEFAULT_SHOP_ID) {
    return null;
  }

  const canDelete = confirmName.trim() === shopName;

  const handleClose = () => {
    if (loading) return;
    setOpen(false);
    setConfirmName("");
    setError(null);
  };

  const handleDelete = async () => {
    if (!canDelete) return;
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/platform/shops/${shopId}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error ?? "Could not delete shop.");
        return;
      }
      handleClose();
      router.refresh();
    } catch {
      setError("Could not delete shop. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="whitespace-nowrap rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Delete
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4"
            onClick={(event) => event.target === event.currentTarget && handleClose()}
          >
            <div
              className="my-auto w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-shop-title"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="delete-shop-title" className="text-lg font-semibold text-slate-900">
                Delete shop
              </h2>
              <p className="mt-2 break-words text-sm text-slate-600">
                This permanently deletes{" "}
                <span className="font-medium text-slate-900">{shopName}</span> and all of its data.
                This cannot be undone.
              </p>
              <p className="mt-4 break-words text-sm text-slate-600">
                Type <span className="font-medium text-slate-900">{shopName}</span> to confirm.
              </p>
              <input
                type="text"
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                placeholder={shopName}
                autoComplete="off"
                disabled={loading}
              />
              {error && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  {error}
                </p>
              )}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={loading}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={!canDelete || loading}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Deleting..." : "Delete shop"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
