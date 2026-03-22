"use client";

import { formatCustomerName } from "@/lib/customer";

interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
}

interface CustomerEditModalProps {
  customer: Customer | null;
  isOpen: boolean;
  onClose: () => void;
  formState: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
    notes: string;
  };
  onFormChange: (field: string, value: string) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}

export function CustomerEditModal({
  customer,
  isOpen,
  onClose,
  formState,
  onFormChange,
  onSave,
  saving,
}: CustomerEditModalProps) {
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-slate-900">
            Edit {customer ? formatCustomerName(customer) : "Customer"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                First name *
              </label>
              <input
                value={formState.firstName}
                onChange={(e) => onFormChange("firstName", e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Last name
              </label>
              <input
                value={formState.lastName}
                onChange={(e) => onFormChange("lastName", e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={formState.email}
                onChange={(e) => onFormChange("email", e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Phone
              </label>
              <input
                value={formState.phone}
                onChange={(e) => onFormChange("phone", e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Address
              </label>
              <input
                value={formState.address}
                onChange={(e) => onFormChange("address", e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Notes
              </label>
              <textarea
                value={formState.notes}
                onChange={(e) => onFormChange("notes", e.target.value)}
                rows={2}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={saving || !formState.firstName.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
