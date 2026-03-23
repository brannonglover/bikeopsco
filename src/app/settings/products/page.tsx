"use client";

import { useState, useEffect, useRef } from "react";
import { Price } from "@/components/ui/Price";

const SUPPLIER_OPTIONS = ["Amazon", "Performance Bike", "Other"];

interface Product {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  stockQuantity: number;
  supplier: string | null;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editStockQuantity, setEditStockQuantity] = useState("");
  const [editSupplier, setEditSupplier] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newStockQuantity, setNewStockQuantity] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [uploading, setUploading] = useState(false);
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
    stockQuantityColumn: 3 as number | null,
    supplierColumn: 4 as number | null,
  });
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
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

  useEffect(() => {
    const url = searchQuery
      ? `/api/products?q=${encodeURIComponent(searchQuery)}`
      : "/api/products";
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        const normalized = (Array.isArray(data) ? data : []).map(
          (p: Product & { price?: unknown; stockQuantity?: unknown }) => ({
            ...p,
            price: typeof p.price === "string" ? parseFloat(p.price) : Number(p.price ?? 0),
            stockQuantity: typeof p.stockQuantity === "string"
              ? parseInt(p.stockQuantity, 10)
              : Number(p.stockQuantity ?? 0),
          })
        );
        setProducts(normalized);
      })
      .finally(() => setLoading(false));
  }, [searchQuery]);

  const startEdit = (product: Product) => {
    setEditing(product.id);
    setEditName(product.name);
    setEditDescription(product.description ?? "");
    setEditImageUrl(product.imageUrl ?? "");
    setEditPrice(String(product.price));
    setEditStockQuantity(String(product.stockQuantity));
    setEditSupplier(product.supplier ?? "");
  };

  const cancelEdit = () => {
    setEditing(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/products/${editing}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          description: editDescription || null,
          imageUrl: editImageUrl.trim() || null,
          price: parseFloat(editPrice) || 0,
          stockQuantity: parseInt(editStockQuantity, 10) || 0,
          supplier: editSupplier.trim() || null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProducts((prev) =>
          prev.map((p) =>
            p.id === updated.id
              ? {
                  ...updated,
                  price:
                    typeof updated.price === "string"
                      ? parseFloat(updated.price)
                      : Number(updated.price),
                  stockQuantity:
                    typeof updated.stockQuantity === "string"
                      ? parseInt(updated.stockQuantity, 10)
                      : Number(updated.stockQuantity ?? 0),
                }
              : p
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
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || null,
          imageUrl: newImageUrl.trim() || null,
          price: parseFloat(newPrice) || 0,
          stockQuantity: parseInt(newStockQuantity, 10) || 0,
          supplier: newSupplier.trim() || null,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setProducts((prev) => [
          ...prev,
          {
            ...created,
            price:
              typeof created.price === "string"
                ? parseFloat(created.price)
                : Number(created.price),
            stockQuantity:
              typeof created.stockQuantity === "string"
                ? parseInt(created.stockQuantity, 10)
                : Number(created.stockQuantity ?? 0),
          },
        ]);
        setShowAddForm(false);
        setNewName("");
        setNewDescription("");
        setNewImageUrl("");
        setNewPrice("");
        setNewStockQuantity("");
        setNewSupplier("");
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (
    file: File,
    setImageUrl: (url: string) => void
  ) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/products/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.url) {
        setImageUrl(data.url);
      } else {
        alert(data.error || "Upload failed");
      }
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete product "${name}"?`)) return;
    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      if (res.ok) {
        setProducts((prev) => prev.filter((p) => p.id !== id));
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete");
      }
    } catch {
      alert("Failed to delete");
    }
  };

  const handleExport = () => {
    const headers = ["name", "description", "price", "stockQuantity", "supplier"];
    const rows = products.map((p) =>
      [
        p.name,
        p.description ?? "",
        String(p.price),
        String(p.stockQuantity),
        p.supplier ?? "",
      ]
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
    a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
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
      const res = await fetch("/api/products/import/preview", {
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
          priceColumn: colCount >= 2 ? Math.min(2, colCount - 1) : 0,
          stockQuantityColumn: colCount >= 4 ? 3 : null,
          supplierColumn: colCount >= 5 ? 4 : null,
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
      const res = await fetch("/api/products/import", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        setImportResult({ created: data.created, errors: data.errors });
        setImportPreview(null);
        fetch("/api/products")
          .then((r) => r.json())
          .then((d) => {
            const normalized = (Array.isArray(d) ? d : []).map(
              (p: Product & { price?: unknown; stockQuantity?: unknown }) => ({
                ...p,
                price: typeof p.price === "string" ? parseFloat(p.price) : Number(p.price ?? 0),
                stockQuantity:
                  typeof p.stockQuantity === "string"
                    ? parseInt(p.stockQuantity, 10)
                    : Number(p.stockQuantity ?? 0),
              })
            );
            setProducts(normalized);
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

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500">Loading products...</div>
    );
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-blue-900 mb-2">Product Inventory</h1>
      <p className="text-slate-600 mb-6">
        Track products you purchase for bike installations—parts, accessories,
        and supplies. Record where you buy from (e.g. Amazon, Performance Bike)
        and keep inventory counts. Use price for your purchase cost.{" "}
        <span className="text-slate-500">
          Import from CSV or Excel. Map columns to name, description (optional),
          price, stock quantity, and supplier.
        </span>
      </p>

      <div className="flex flex-wrap gap-3 mb-6 items-center">
        {!showAddForm ? (
          <>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
            >
              + Add Product
            </button>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, description, or supplier..."
              className="w-48 sm:w-56 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
            />
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
                        "name,description,price,stockQuantity,supplier\nChain Lube,Wet lubricant for chains,12.99,24,Amazon\nBrake Pads,Metallic brake pads,45.00,10,Performance Bike";
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "products-template.csv";
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
            <h3 className="font-semibold text-slate-900">New Product</h3>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Name
              </label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                placeholder="e.g. Bike Pump, Chain Lube"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Description
              </label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                placeholder="Brief description of the product"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Supplier
                </label>
                <input
                  list="supplier-list"
                  value={newSupplier}
                  onChange={(e) => setNewSupplier(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  placeholder="e.g. Amazon, Performance Bike"
                />
                <datalist id="supplier-list">
                  {SUPPLIER_OPTIONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Stock quantity
                </label>
                <input
                  type="number"
                  min="0"
                  value={newStockQuantity}
                  onChange={(e) => setNewStockQuantity(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  placeholder="0"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Purchase price ($)
              </label>
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
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Image
              </label>
              <div className="flex items-center gap-4">
                {newImageUrl ? (
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={newImageUrl}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-slate-600">Image selected</span>
                      <button
                        type="button"
                        onClick={() => setNewImageUrl("")}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleImageUpload(f, setNewImageUrl);
                        e.target.value = "";
                      }}
                    />
                    <span className="text-sm text-slate-500">
                      {uploading ? "Uploading..." : "Choose image from computer"}
                    </span>
                  </label>
                )}
              </div>
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
                  setNewImageUrl("");
                  setNewPrice("");
                  setNewStockQuantity("");
                  setNewSupplier("");
                  setUploading(false);
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
                    const res = await fetch("/api/products/import/preview", {
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
                        priceColumn: colCount >= 2 ? Math.min(2, colCount - 1) : 0,
                        stockQuantityColumn: colCount >= 4 ? 3 : null,
                        supplierColumn: colCount >= 5 ? 4 : null,
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Product name</label>
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
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Description (optional)
              </label>
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
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Stock quantity (optional)
              </label>
              <select
                value={importMapping.stockQuantityColumn ?? ""}
                onChange={(e) =>
                  setImportMapping((m) => ({
                    ...m,
                    stockQuantityColumn: e.target.value === "" ? null : Number(e.target.value),
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
                Supplier (optional)
              </label>
              <select
                value={importMapping.supplierColumn ?? ""}
                onChange={(e) =>
                  setImportMapping((m) => ({
                    ...m,
                    supplierColumn: e.target.value === "" ? null : Number(e.target.value),
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
              Imported {importResult.created} product{importResult.created !== 1 ? "s" : ""}.
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
        {products.length === 0 && !showAddForm ? (
          <p className="text-slate-500 py-8">
            No products yet. Add one to get started.
          </p>
        ) : (
          products.map((product) => (
            <div
              key={product.id}
              className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm flex gap-4"
            >
              {product.imageUrl ? (
                <div className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="flex-shrink-0 w-20 h-20 rounded-lg bg-slate-200 flex items-center justify-center text-slate-400 text-xs">
                  No image
                </div>
              )}
              <div className="flex-1 min-w-0">
                {editing !== product.id ? (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-slate-900">
                          {product.name}
                        </h3>
                        {product.description && (
                          <p className="text-sm text-slate-600 mt-1 whitespace-pre-line">
                            {product.description}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-3 text-sm">
                          <Price amount={Number(product.price)} />
                          <span className="text-slate-500">
                            Stock: {product.stockQuantity}
                          </span>
                          {product.supplier && (
                            <span className="text-slate-500">
                              From: {product.supplier}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => startEdit(product)}
                          className="text-sm text-blue-600 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(product.id, product.name)}
                          className="text-sm text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Name
                      </label>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Description
                      </label>
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={2}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Supplier
                        </label>
                        <input
                          list="supplier-list-edit"
                          value={editSupplier}
                          onChange={(e) => setEditSupplier(e.target.value)}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                          placeholder="e.g. Amazon, Performance Bike"
                        />
                        <datalist id="supplier-list-edit">
                          {SUPPLIER_OPTIONS.map((s) => (
                            <option key={s} value={s} />
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Stock quantity
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={editStockQuantity}
                          onChange={(e) => setEditStockQuantity(e.target.value)}
                          className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Purchase price ($)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Image
                      </label>
                      <div className="flex items-center gap-4">
                        {editImageUrl ? (
                          <div className="flex items-center gap-3">
                            <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={editImageUrl}
                                alt="Preview"
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-sm text-slate-600">Image selected</span>
                              <button
                                type="button"
                                onClick={() => setEditImageUrl("")}
                                className="text-sm text-red-600 hover:underline"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors min-w-[140px]">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            className="hidden"
                            disabled={uploading}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleImageUpload(f, setEditImageUrl);
                              e.target.value = "";
                            }}
                          />
                          <span className="text-sm text-slate-500 px-2 text-center">
                            {uploading ? "Uploading..." : editImageUrl ? "Replace" : "Choose image"}
                          </span>
                        </label>
                      </div>
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
