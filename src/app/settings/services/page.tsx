"use client";

import { useState, useEffect, useRef } from "react";
import { Price } from "@/components/ui/Price";

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number;
  isSystem?: boolean;
}

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    created: number;
    errors?: { row: number; message: string }[];
  } | null>(null);
  const [importPreview, setImportPreview] = useState<{
    file: File;
    headers: string[];
    sampleRows: string[][];
    rowCount: number;
  } | null>(null);
  const [importMapping, setImportMapping] = useState({
    nameColumn: 0,
    descriptionColumn: 1 as number | null,
    priceColumn: 2,
  });
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true);
  const [expandedServiceIds, setExpandedServiceIds] = useState<Set<string>>(new Set());
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const toggleExpanded = (id: string) => {
    setExpandedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    fetch("/api/services")
      .then((res) => res.json())
      .then((data) => {
        const normalized = (Array.isArray(data) ? data : []).map((s: Service & { price?: unknown }) => ({
          ...s,
          price: typeof s.price === "string" ? parseFloat(s.price) : Number(s.price ?? 0),
        }));
        setServices(normalized);
      })
      .finally(() => setLoading(false));
  }, []);

  const startEdit = (s: Service) => {
    setEditing(s.id);
    setEditName(s.name);
    setEditDescription(s.description ?? "");
    setEditPrice(String(s.price));
  };

  const cancelEdit = () => {
    setEditing(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/services/${editing}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          description: editDescription || null,
          price: parseFloat(editPrice) || 0,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setServices((prev) =>
          prev.map((s) =>
            s.id === updated.id
              ? { ...updated, price: typeof updated.price === "string" ? parseFloat(updated.price) : Number(updated.price) }
              : s
          )
        );
        setEditing(null);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || null,
          price: parseFloat(newPrice) || 0,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setServices((prev) => [
          ...prev,
          { ...created, price: typeof created.price === "string" ? parseFloat(created.price) : Number(created.price) },
        ]);
        setShowAddForm(false);
        setNewName("");
        setNewDescription("");
        setNewPrice("");
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const headers = ["name", "description", "price"];
    const rows = services.map((s) =>
      [s.name, s.description ?? "", String(s.price)]
        .map((v) =>
          v.includes(",") || v.includes('"') || v.includes("\n")
            ? `"${v.replace(/"/g, '""')}"`
            : v
        )
        .join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `services-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setActionsOpen(false);
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
      const res = await fetch("/api/services/import/preview", {
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
        setImportMapping({
          nameColumn: 0,
          descriptionColumn: colCount >= 3 ? 1 : null,
          priceColumn: colCount >= 3 ? 2 : Math.min(1, Math.max(0, colCount - 1)),
        });
      } else {
        alert(data.detail ? `${data.error}\n\n${data.detail}` : data.error || "Preview failed");
      }
    } catch {
      alert("Preview failed");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
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
      const res = await fetch("/api/services/import", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        setImportResult({ created: data.created, errors: data.errors });
        setImportPreview(null);
        fetch("/api/services")
          .then((r) => r.json())
          .then((d) => {
            const normalized = (Array.isArray(d) ? d : []).map((s: Service & { price?: unknown }) => ({
              ...s,
              price: typeof s.price === "string" ? parseFloat(s.price) : Number(s.price ?? 0),
            }));
            setServices(normalized);
          });
      } else {
        alert(data.detail ? `${data.error}\n\n${data.detail}` : data.error || "Import failed");
      }
    } catch {
      alert("Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete service "${name}"?`)) return;
    try {
      const res = await fetch(`/api/services/${id}`, { method: "DELETE" });
      if (res.ok) {
        setServices((prev) => prev.filter((s) => s.id !== id));
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete");
      }
    } catch {
      alert("Failed to delete");
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500">Loading services...</div>
    );
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-blue-900 mb-2">Services</h1>
      <p className="text-slate-600 mb-6">
        Add and manage services you offer. These can be attached to jobs when creating or editing them.{" "}
        <span className="text-slate-500">
          Import from CSV or Excel. Map your spreadsheet columns to name, description (optional), and price.
        </span>
      </p>

      <div className="flex flex-wrap gap-3 mb-6 items-center">
        {!showAddForm ? (
          <>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
            >
              + Add Service
            </button>
            <div className="ml-auto relative" ref={actionsRef}>
              <button
                type="button"
                onClick={() => setActionsOpen((o) => !o)}
                className="px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 font-medium text-slate-700"
              >
                Actions ▾
              </button>
              {actionsOpen && (
                <div className="absolute right-0 mt-1 py-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-10">
                  <button
                    type="button"
                    onClick={handleExport}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Export
                  </button>
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
                    onClick={() => {
                      const csv =
                        "name,description,price\nFull Service,Complete bike tune-up,125.00\nBrake Pad Replacement,Front and rear pads,45.00";
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "services-template.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                      setActionsOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Download sample CSV
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="p-4 border border-slate-200 rounded-lg bg-white shadow-sm space-y-3 w-full">
          <h3 className="font-semibold text-slate-900">New Service</h3>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg"
              placeholder="e.g. Full Service, Brake Pad Replacement"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg"
              placeholder="Brief description of the service"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Price ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg"
              placeholder="0.00"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving || !newName.trim()}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Adding..." : "Add"}
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewName("");
                setNewDescription("");
                setNewPrice("");
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
              Map columns · {importPreview.rowCount} row{importPreview.rowCount !== 1 ? "s" : ""} to import
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
                    const res = await fetch("/api/services/import/preview", {
                      method: "POST",
                      body: formData,
                    });
                    const data = await res.json();
                    if (res.ok) {
                      const colCount = data.headers?.length ?? 0;
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
                      setImportMapping((m) => ({
                        ...m,
                        descriptionColumn: colCount >= 3 ? 1 : null,
                        priceColumn: colCount >= 3 ? 2 : Math.min(1, Math.max(0, colCount - 1)),
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Service name</label>
              <select
                value={importMapping.nameColumn}
                onChange={(e) =>
                  setImportMapping((m) => ({ ...m, nameColumn: Number(e.target.value) }))
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Description (optional)</label>
              <select
                value={importMapping.descriptionColumn ?? ""}
                onChange={(e) =>
                  setImportMapping((m) => ({
                    ...m,
                    descriptionColumn: e.target.value === "" ? null : Number(e.target.value),
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Price</label>
              <select
                value={importMapping.priceColumn}
                onChange={(e) =>
                  setImportMapping((m) => ({ ...m, priceColumn: Number(e.target.value) }))
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
          </div>

          {importPreview.sampleRows.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Preview</p>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      {importPreview.headers.map((h, i) => (
                        <th key={i} className="px-3 py-2 text-left font-medium text-slate-700">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.sampleRows.map((row, ri) => (
                      <tr key={ri} className="border-t border-slate-100">
                        {importPreview.headers.map((_, ci) => (
                          <td key={ci} className="px-3 py-2 text-slate-600">
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
        <div className="mb-6 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 flex justify-between items-start gap-4">
          <div>
            <p className="font-medium">
              Imported {importResult.created} service{importResult.created !== 1 ? "s" : ""}.
            </p>
            {importResult.errors && importResult.errors.length > 0 && (
              <ul className="mt-2 text-sm list-disc list-inside">
                {importResult.errors.map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => setImportResult(null)}
            className="text-emerald-600 hover:text-emerald-800"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className="space-y-4">
        {services.length === 0 && !showAddForm ? (
          <p className="text-slate-500 py-8">No services yet. Add one to get started.</p>
        ) : (
          services.map((s) => (
            <div
              key={s.id}
              className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                {editing !== s.id ? (
                  <>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-slate-900 flex flex-wrap items-center gap-2">
                        {s.name}
                        {s.isSystem && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                            Auto
                          </span>
                        )}
                      </h3>
                      <div className="mt-2">
                        <Price amount={Number(s.price)} />
                      </div>
                      {(s.description?.trim() ?? "") !== "" && (
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(s.id)}
                            className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 focus:outline-none"
                            aria-expanded={expandedServiceIds.has(s.id)}
                          >
                            <span>
                              {expandedServiceIds.has(s.id) ? "Hide" : "Show"} what&apos;s included
                            </span>
                            <svg
                              className={`w-4 h-4 transition-transform ${expandedServiceIds.has(s.id) ? "rotate-180" : ""}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {expandedServiceIds.has(s.id) && (
                            <ul className="mt-2 pl-5 text-sm text-slate-600 space-y-1 list-disc">
                              {s.description!
                                .split(/\r?\n/)
                                .filter((line) => line.trim())
                                .map((line, i) => (
                                  <li key={i} className="whitespace-pre-wrap">
                                    {line.trim().replace(/^[-•*]\s*/, "")}
                                  </li>
                                ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => startEdit(s)}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        Edit
                      </button>
                      {!s.isSystem && (
                        <button
                          onClick={() => handleDelete(s.id, s.name)}
                          className="text-sm text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={2}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Price ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={saveEdit}
                        disabled={saving}
                        className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="text-sm text-slate-600 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
