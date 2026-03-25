"use client";

import { useState, useEffect, useRef } from "react";
import { formatCustomerName } from "@/lib/customer";
import {
  formatPhoneInputUS,
  formatPhoneDisplay,
  phoneTelHref,
  phoneToInputValue,
} from "@/lib/phone";
import { CustomerDetailModal } from "@/components/customers/CustomerDetailModal";
import { CustomerEditModal } from "@/components/customers/CustomerEditModal";

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

function findColumnForImport(
  headers: string[],
  ...patterns: string[]
): number | null {
  const normalize = (s: string) => s.toLowerCase().replace(/\s/g, "");
  const target = patterns.map((p) => normalize(p));
  const idx = headers.findIndex((h) =>
    target.some((t) => normalize(h).includes(t) || t.includes(normalize(h)))
  );
  return idx >= 0 ? idx : null;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    created: number;
    errors?: { row: number; message: string }[];
    debug?: {
      headers: { col: number; name: string }[];
      firstRow: { col: number; header: string; value: string }[];
      mapping: { firstNameColumn: number; lastNameColumn: number | null };
      parsedFromFirstRow?: { firstName: string; lastName: string | null };
    };
  } | null>(null);
  const [importPreview, setImportPreview] = useState<{
    file: File;
    headers: string[];
    sampleRows: string[][];
    rowCount: number;
  } | null>(null);
  const [importMapping, setImportMapping] = useState({
    firstNameColumn: 0,
    lastNameColumn: 1 as number | null,
    emailColumn: 2 as number | null,
    phoneColumn: 3 as number | null,
    addressColumn: 4 as number | null,
    notesColumn: 5 as number | null,
  });
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const url = searchQuery
      ? `/api/customers?q=${encodeURIComponent(searchQuery)}`
      : "/api/customers";
    fetch(url)
      .then((res) => res.json())
      .then((data) => setCustomers(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [searchQuery]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const startEdit = (c: Customer) => {
    setEditingCustomer(c);
    setEditFirstName(c.firstName);
    setEditLastName(c.lastName ?? "");
    setEditEmail(c.email ?? "");
    setEditPhone(phoneToInputValue(c.phone));
    setEditAddress(c.address ?? "");
    setEditNotes(c.notes ?? "");
  };

  const cancelEdit = () => {
    setEditingCustomer(null);
  };

  const handleFormChange = (field: string, value: string) => {
    switch (field) {
      case "firstName": setEditFirstName(value); break;
      case "lastName": setEditLastName(value); break;
      case "email": setEditEmail(value); break;
      case "phone": setEditPhone(formatPhoneInputUS(value)); break;
      case "address": setEditAddress(value); break;
      case "notes": setEditNotes(value); break;
    }
  };

  const saveEdit = async () => {
    if (!editingCustomer) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${editingCustomer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: editFirstName.trim(),
          lastName: editLastName.trim() || null,
          email: editEmail.trim() || null,
          phone: editPhone.trim() || null,
          address: editAddress.trim() || null,
          notes: editNotes.trim() || null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCustomers((prev) =>
          prev.map((c) => (c.id === updated.id ? updated : c))
        );
        setEditingCustomer(null);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!newFirstName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: newFirstName.trim(),
          lastName: newLastName.trim() || null,
          email: newEmail.trim() || null,
          phone: newPhone.trim() || null,
          address: newAddress.trim() || null,
          notes: newNotes.trim() || null,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setCustomers((prev) => [created, ...prev]);
        setShowAddForm(false);
        setNewFirstName("");
        setNewLastName("");
        setNewEmail("");
        setNewPhone("");
        setNewAddress("");
        setNewNotes("");
      } else {
        const err = await res.json();
        const msg =
          typeof err.error === "object"
            ? Object.values(err.error)
                .flat()
                .filter(Boolean)
                .join("; ")
            : err.error || "Failed to create";
        alert(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, displayName: string) => {
    if (!confirm(`Delete customer "${displayName}"? Jobs linked to this customer will no longer show their details.`))
      return;
    try {
      const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
      if (res.ok) {
        setCustomers((prev) => prev.filter((c) => c.id !== id));
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete");
      }
    } catch {
      alert("Failed to delete");
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setImportPreview(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("firstRowIsHeader", "true");
      const res = await fetch("/api/customers/import/preview", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        const colCount = data.headers?.length ?? 0;
        setImportPreview({
          file,
          headers: data.headers ?? [],
          sampleRows: data.sampleRows ?? [],
          rowCount: data.rowCount ?? 0,
        });
        setFirstRowIsHeader(true);
        const headers = data.headers ?? [];
        setImportMapping({
          firstNameColumn:
            findColumnForImport(headers, "firstname", "first name", "name") ?? 0,
          lastNameColumn:
            findColumnForImport(headers, "lastname", "last name") ??
            (colCount >= 2 ? 1 : null),
          emailColumn:
            findColumnForImport(headers, "email") ?? (colCount >= 3 ? 2 : null),
          phoneColumn:
            findColumnForImport(headers, "phone", "mobile", "tel") ??
            (colCount >= 4 ? 3 : null),
          addressColumn:
            findColumnForImport(headers, "address", "street") ??
            (colCount >= 5 ? 4 : null),
          notesColumn: findColumnForImport(headers, "notes") ?? (colCount >= 6 ? 5 : null),
        });
      } else {
        alert(
          data.detail
            ? `${data.error}\n\n${data.detail}`
            : data.error || "Preview failed"
        );
      }
    } catch {
      alert("Preview failed");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const handleExport = () => {
    const headers = ["FirstName", "LastName", "Email", "Phone", "Address", "Notes"];
    const rows = customers.map((c) =>
      [
        c.firstName,
        c.lastName ?? "",
        c.email ?? "",
        c.phone ? formatPhoneDisplay(c.phone) : "",
        c.address ?? "",
        c.notes ?? "",
      ]
        .map((v) => (v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v))
        .join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setActionsOpen(false);
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", importPreview.file);
      formData.append("mapping", JSON.stringify(importMapping));
      formData.append("firstRowIsHeader", String(firstRowIsHeader));
      const res = await fetch("/api/customers/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setImportResult({
          created: data.created,
          errors: data.errors,
          debug: data.debug,
        });
        setImportPreview(null);
        const url = searchQuery
          ? `/api/customers?q=${encodeURIComponent(searchQuery)}`
          : "/api/customers";
        fetch(url)
          .then((r) => r.json())
          .then((d) => setCustomers(Array.isArray(d) ? d : []));
      } else {
        alert(
          data.detail
            ? `${data.error}\n\n${data.detail}`
            : data.error || "Import failed"
        );
      }
    } catch {
      alert("Import failed");
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500">Loading customers...</div>
    );
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">
        Customers
        <span className="ml-2 font-medium text-slate-500 text-lg">
          ({customers.length} {customers.length === 1 ? "customer" : "customers"})
        </span>
      </h1>
      <p className="text-slate-600 mb-6 leading-relaxed">
        Add and manage customers. Link them to jobs for quicker data entry and
        customer history.{" "}
        <span className="text-slate-500">
          Import from CSV or Excel. Map columns to first name, last name, email,
          phone, address, and notes.
        </span>
      </p>

      <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-6 items-stretch sm:items-center">
        {!showAddForm ? (
          <>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-semibold shadow-soft hover:bg-indigo-700 hover:shadow-soft-lg transition-all duration-200 touch-manipulation min-h-[44px]"
            >
              + Add Customer
            </button>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, email, or phone..."
              className="flex-1 min-w-0 px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-shadow"
            />
            <div className="sm:ml-auto relative" ref={actionsRef}>
              <button
                type="button"
                onClick={() => setActionsOpen((o) => !o)}
                className="w-full sm:w-auto px-4 py-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 font-medium text-slate-700 shadow-sm transition-colors touch-manipulation min-h-[44px]"
              >
                Actions ▾
              </button>
              {actionsOpen && (
                <div className="absolute right-0 mt-1 py-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-10">
                  <label className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={(e) => {
                        handleFileSelect(e);
                        setActionsOpen(false);
                      }}
                      disabled={importing}
                      className="sr-only"
                    />
                    {importing ? "Loading..." : "Import"}
                  </label>
                  <button
                    type="button"
                    onClick={handleExport}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const csv =
                        "FirstName,LastName,Email,Phone,Address,Notes\nJane,Smith,jane@example.com,555-123-4567,123 Main St,Preferred customer\nJohn,Doe,john@example.com,,456 Oak Ave,";
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "customers-template.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                      setActionsOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Download template
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="p-5 border border-slate-200/80 rounded-xl bg-white shadow-soft space-y-4 w-full">
            <h3 className="font-semibold text-slate-900">New Customer</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  First name *
                </label>
                <input
                  value={newFirstName}
                  onChange={(e) => setNewFirstName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  placeholder="e.g. Jane"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Last name
                </label>
                <input
                  value={newLastName}
                  onChange={(e) => setNewLastName(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  placeholder="e.g. Smith"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  placeholder="jane@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  autoComplete="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(formatPhoneInputUS(e.target.value))}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Address
                </label>
                <input
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  placeholder="123 Main St, City"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  placeholder="Internal notes about this customer"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={saving || !newFirstName.trim()}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "Adding..." : "Add"}
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewFirstName("");
                  setNewLastName("");
                  setNewEmail("");
                  setNewPhone("");
                  setNewAddress("");
                  setNewNotes("");
                }}
                className="px-4 py-2 text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {importPreview && (
        <div className="mb-6 p-4 border border-slate-200 rounded-lg bg-white shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold text-slate-900">
              Map columns · {importPreview.rowCount} row
              {importPreview.rowCount !== 1 ? "s" : ""} to import
            </h3>
            <button
              type="button"
              onClick={() => setImportPreview(null)}
              className="text-slate-500 hover:text-slate-700"
              aria-label="Cancel import"
            >
              × Cancel
            </button>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={firstRowIsHeader}
              onChange={async (e) => {
                const checked = e.target.checked;
                setFirstRowIsHeader(checked);
                if (importPreview) {
                  setImporting(true);
                  try {
                    const formData = new FormData();
                    formData.append("file", importPreview.file);
                    formData.append("firstRowIsHeader", String(checked));
                    const res = await fetch("/api/customers/import/preview", {
                      method: "POST",
                      body: formData,
                    });
                    const data = await res.json();
                    if (res.ok) {
                      setImportPreview((p) =>
                        p
                          ? {
                              ...p,
                              headers: data.headers ?? [],
                              sampleRows: data.sampleRows ?? [],
                              rowCount: data.rowCount ?? 0,
                            }
                          : null
                      );
                      const h = data.headers ?? [];
                      setImportMapping((m) => ({
                        ...m,
                        firstNameColumn:
                          findColumnForImport(h, "firstname", "first name", "name") ?? 0,
                        lastNameColumn:
                          findColumnForImport(h, "lastname", "last name") ??
                          (h.length >= 2 ? 1 : null),
                        emailColumn:
                          findColumnForImport(h, "email") ?? (h.length >= 3 ? 2 : null),
                        phoneColumn:
                          findColumnForImport(h, "phone", "mobile", "tel") ??
                          (h.length >= 4 ? 3 : null),
                        addressColumn:
                          findColumnForImport(h, "address", "street") ??
                          (h.length >= 5 ? 4 : null),
                        notesColumn:
                          findColumnForImport(h, "notes") ?? (h.length >= 6 ? 5 : null),
                      }));
                    }
                  } finally {
                    setImporting(false);
                  }
                }
              }}
            />
            First row contains column headers
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                First name *
              </label>
              <select
                value={importMapping.firstNameColumn}
                onChange={(e) =>
                  setImportMapping((m) => ({
                    ...m,
                    firstNameColumn: Number(e.target.value),
                  }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              >
                {importPreview.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Last name
              </label>
              <select
                value={importMapping.lastNameColumn ?? ""}
                onChange={(e) =>
                  setImportMapping((m) => ({
                    ...m,
                    lastNameColumn:
                      e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              >
                <option value="">— Don&apos;t import —</option>
                {importPreview.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <select
                value={importMapping.emailColumn ?? ""}
                onChange={(e) =>
                  setImportMapping((m) => ({
                    ...m,
                    emailColumn:
                      e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              >
                <option value="">— Don&apos;t import —</option>
                {importPreview.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Phone
              </label>
              <select
                value={importMapping.phoneColumn ?? ""}
                onChange={(e) =>
                  setImportMapping((m) => ({
                    ...m,
                    phoneColumn:
                      e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              >
                <option value="">— Don&apos;t import —</option>
                {importPreview.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Address
              </label>
              <select
                value={importMapping.addressColumn ?? ""}
                onChange={(e) =>
                  setImportMapping((m) => ({
                    ...m,
                    addressColumn:
                      e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              >
                <option value="">— Don&apos;t import —</option>
                {importPreview.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Notes
              </label>
              <select
                value={importMapping.notesColumn ?? ""}
                onChange={(e) =>
                  setImportMapping((m) => ({
                    ...m,
                    notesColumn:
                      e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              >
                <option value="">— Don&apos;t import —</option>
                {importPreview.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {importPreview.sampleRows.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">
                Preview
              </p>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      {importPreview.headers.map((h, i) => (
                        <th
                          key={i}
                          className="px-3 py-2 text-left font-medium text-slate-700"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.sampleRows.map((row, ri) => (
                      <tr
                        key={ri}
                        className="border-t border-slate-100"
                      >
                        {importPreview.headers.map((_, ci) => (
                          <td
                            key={ci}
                            className="px-3 py-2 text-slate-600"
                          >
                            {row[ci] ?? "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <button
            onClick={handleConfirmImport}
            disabled={importing}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-medium"
          >
            {importing ? "Importing..." : "Import"}
          </button>
        </div>
      )}

      {importResult && (
        <div
          className={`mb-6 p-4 rounded-lg border flex justify-between items-start gap-4 ${
            importResult.created > 0
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-amber-50 border-amber-200 text-amber-800"
          }`}
        >
          <div>
            <p className="font-medium">
              {importResult.created > 0 ? (
                <>
                  Imported {importResult.created} customer
                  {importResult.created !== 1 ? "s" : ""}.
                </>
              ) : (
                <>No customers were imported.</>
              )}
            </p>
            {importResult.errors && importResult.errors.length > 0 && (
              <>
                <p className="mt-2 text-sm">
                  {importResult.errors.length} row
                  {importResult.errors.length !== 1 ? "s" : ""} had issues:
                </p>
                <ul className="mt-1 text-sm list-disc list-inside max-h-32 overflow-y-auto">
                  {importResult.errors.slice(0, 10).map((e) => (
                    <li key={e.row}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                  {importResult.errors.length > 10 && (
                    <li>... and {importResult.errors.length - 10} more</li>
                  )}
                </ul>
                <p className="mt-2 text-sm font-medium">
                  Tip: Ensure &quot;First name&quot; is mapped to a column that
                  has values in every row.
                </p>
                {importResult.debug && (
                  <div className="mt-3 p-3 bg-amber-100/50 rounded text-xs font-mono">
                    <p className="font-semibold mb-1">
                      First row of your file (what we parsed):
                    </p>
                    <div className="space-y-0.5">
                      {importResult.debug.firstRow.map((c) => (
                        <div key={c.col}>
                          Col {c.col} ({c.header}):{" "}
                          {c.value ? (
                            <span className="text-emerald-800">
                              &quot;{c.value}&quot;
                            </span>
                          ) : (
                            <span className="text-amber-600 italic">empty</span>
                          )}
                        </div>
                      ))}
                    </div>
                    {importResult.debug.parsedFromFirstRow && (
                      <p className="mt-2 font-semibold">
                        What we parsed: First=&quot;{importResult.debug.parsedFromFirstRow.firstName}&quot;,
                        Last=&quot;{importResult.debug.parsedFromFirstRow.lastName ?? "(empty)"}&quot;
                      </p>
                    )}
                    <p className="mt-2 font-semibold">
                      Currently mapped: First name → column{" "}
                      {importResult.debug.mapping.firstNameColumn}. That column
                      needs to have a value—adjust the mapping if the names are
                      in a different column.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setImportResult(null)}
            className={
              importResult.created > 0
                ? "text-emerald-600 hover:text-emerald-800"
                : "text-amber-600 hover:text-amber-800"
            }
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className="space-y-4">
        {customers.length === 0 && !showAddForm ? (
          <p className="text-slate-500 py-8">
            No customers yet. Add one to get started.
          </p>
        ) : (
          customers.map((c) => (
            <div
              key={c.id}
              className="border border-slate-200/80 rounded-xl p-4 bg-white shadow-soft hover:shadow-soft-lg transition-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                <button
                  type="button"
                  onClick={() => setDetailCustomer(c)}
                  className="flex-1 text-left min-w-0"
                >
                  <h3 className="font-semibold text-slate-900 hover:text-indigo-600 transition-colors">
                    {formatCustomerName(c)}
                  </h3>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-600">
                    {c.email && (
                      <span>
                        <a
                          href={`mailto:${c.email}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-indigo-600 hover:underline"
                        >
                          {c.email}
                        </a>
                      </span>
                    )}
                    {c.phone && (
                      <span>
                        <a
                          href={phoneTelHref(c.phone)}
                          onClick={(e) => e.stopPropagation()}
                          className="text-indigo-600 hover:underline"
                        >
                          {formatPhoneDisplay(c.phone)}
                        </a>
                      </span>
                    )}
                  </div>
                  {c.address && (
                    <p className="text-sm text-slate-600 mt-1">{c.address}</p>
                  )}
                  {c.notes && (
                    <p className="text-sm text-slate-500 mt-2 whitespace-pre-line border-l-2 border-slate-200 pl-2">
                      {c.notes}
                    </p>
                  )}
                </button>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(c);
                    }}
                    className="text-sm text-indigo-600 hover:underline font-medium"
                  >
                    Edit
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(c.id, formatCustomerName(c));
                    }}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <CustomerDetailModal
        customer={detailCustomer}
        isOpen={detailCustomer !== null}
        onClose={() => setDetailCustomer(null)}
        onEdit={(c) => {
          setDetailCustomer(null);
          startEdit(c);
        }}
      />

      <CustomerEditModal
        customer={editingCustomer}
        isOpen={editingCustomer !== null}
        onClose={cancelEdit}
        formState={{
          firstName: editFirstName,
          lastName: editLastName,
          email: editEmail,
          phone: editPhone,
          address: editAddress,
          notes: editNotes,
        }}
        onFormChange={handleFormChange}
        onSave={saveEdit}
        saving={saving}
      />
    </div>
  );
}
