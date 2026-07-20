"use client";

import { useEffect, useRef, useState } from "react";

interface Mechanic {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  birthdate: string | null;
  imageUrl: string | null;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function Portrait({
  name,
  imageUrl,
  sizeClass = "h-28 w-28",
}: {
  name: string;
  imageUrl: string | null;
  sizeClass?: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={imageUrl}
        src={imageUrl}
        alt={name}
        className={`${sizeClass} rounded-full object-cover bg-slate-100`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} rounded-full bg-slate-200 text-slate-600 flex items-center justify-center font-semibold text-xl`}
      aria-hidden
    >
      {initialsFor(name)}
    </div>
  );
}

export default function MechanicsPage() {
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadGeneration = useRef(0);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const resetForm = () => {
    setFullName("");
    setEmail("");
    setPhone("");
    setBirthdate("");
    setImageUrl("");
    uploadGeneration.current++;
    setUploading(false);
  };

  const loadMechanics = () => {
    setLoading(true);
    fetch("/api/mechanics")
      .then((res) => res.json())
      .then((data) => {
        setMechanics(Array.isArray(data) ? data : []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadMechanics();
  }, []);

  const startAdd = () => {
    setEditing(null);
    resetForm();
    setShowAddForm(true);
  };

  const startEdit = (mechanic: Mechanic) => {
    setShowAddForm(false);
    uploadGeneration.current++;
    setUploading(false);
    setEditing(mechanic.id);
    setFullName(mechanic.fullName);
    setEmail(mechanic.email ?? "");
    setPhone(mechanic.phone ?? "");
    setBirthdate(mechanic.birthdate ?? "");
    setImageUrl(mechanic.imageUrl ?? "");
  };

  const cancelForm = () => {
    setShowAddForm(false);
    setEditing(null);
    resetForm();
  };

  const uploadImage = async (file: File) => {
    const gen = ++uploadGeneration.current;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/mechanics/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (gen !== uploadGeneration.current) return;
      if (!res.ok) {
        alert(data.error || "Upload failed");
        return;
      }
      setImageUrl(data.url ?? "");
    } catch {
      if (gen === uploadGeneration.current) {
        alert("Upload failed");
      }
    } finally {
      if (gen === uploadGeneration.current) {
        setUploading(false);
      }
    }
  };

  const saveMechanic = async () => {
    if (!fullName.trim()) {
      alert("Full name is required");
      return;
    }
    setSaving(true);
    const payload = {
      fullName: fullName.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      birthdate: birthdate.trim() || null,
      imageUrl: imageUrl.trim() || null,
    };
    try {
      const res = await fetch(
        editing ? `/api/mechanics/${editing}` : "/api/mechanics",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to save");
        return;
      }
      if (editing) {
        setMechanics((prev) =>
          prev
            .map((m) => (m.id === data.id ? data : m))
            .sort((a, b) => a.fullName.localeCompare(b.fullName))
        );
      } else {
        setMechanics((prev) =>
          [...prev, data].sort((a, b) => a.fullName.localeCompare(b.fullName))
        );
      }
      cancelForm();
    } catch {
      alert("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const deleteMechanic = async (id: string, name: string) => {
    if (!confirm(`Remove ${name} from the roster?`)) return;
    try {
      const res = await fetch(`/api/mechanics/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to delete");
        return;
      }
      setMechanics((prev) => prev.filter((m) => m.id !== id));
      if (editing === id) cancelForm();
    } catch {
      alert("Failed to delete");
    }
  };

  const formFields = (
    <div className="p-4 border border-slate-200 rounded-lg bg-white shadow-sm space-y-3 w-full max-w-xl">
      <h3 className="font-semibold text-slate-900">
        {editing ? "Edit mechanic" : "New mechanic"}
      </h3>
      <div className="flex items-center gap-4">
        <Portrait name={fullName || "New"} imageUrl={imageUrl || null} />
        <div className="space-y-2">
          <label className="inline-flex items-center px-3 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200">
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              disabled={uploading}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadImage(f);
                e.target.value = "";
              }}
            />
            {uploading ? "Uploading..." : imageUrl ? "Replace photo" : "Upload photo"}
          </label>
          {imageUrl && (
            <button
              type="button"
              onClick={() => setImageUrl("")}
              className="block text-sm text-slate-500 hover:text-slate-700"
            >
              Clear photo
            </button>
          )}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Full name
        </label>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          placeholder="e.g. Alex Rivera"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
            placeholder="alex@example.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Phone
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
            placeholder="(555) 555-5555"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Birthdate
        </label>
        <input
          type="date"
          value={birthdate}
          onChange={(e) => setBirthdate(e.target.value)}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg"
        />
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => void saveMechanic()}
          disabled={saving || uploading}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium disabled:opacity-60"
        >
          {saving ? "Saving..." : editing ? "Save changes" : "Add mechanic"}
        </button>
        <button
          type="button"
          onClick={cancelForm}
          disabled={saving}
          className="px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 font-medium text-slate-700"
        >
          Cancel
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              const m = mechanics.find((x) => x.id === editing);
              if (m) void deleteMechanic(m.id, m.fullName);
            }}
            disabled={saving}
            className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium ml-auto"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500">Loading mechanics...</div>
    );
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-blue-900 mb-2">Mechanics</h1>
      <p className="text-slate-600 mb-6">
        Keep a roster of bike mechanics for your shop — photo, contact details,
        and birthdate.
      </p>

      <div className="mb-6">
        {!showAddForm && !editing ? (
          <button
            type="button"
            onClick={startAdd}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
          >
            + Add mechanic
          </button>
        ) : (
          formFields
        )}
      </div>

      {mechanics.length === 0 && !showAddForm ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center">
          <p className="text-slate-700 font-medium">No mechanics yet</p>
          <p className="mt-1 text-slate-500 text-sm">
            Add your first mechanic to start building the shop roster.
          </p>
          <button
            type="button"
            onClick={startAdd}
            className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
          >
            + Add mechanic
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {mechanics.map((mechanic) => {
            const isEditing = editing === mechanic.id;
            return (
              <button
                key={mechanic.id}
                type="button"
                onClick={() => startEdit(mechanic)}
                className={`flex flex-col items-center gap-3 rounded-xl border bg-white p-4 text-center transition-colors touch-manipulation ${
                  isEditing
                    ? "border-emerald-500 ring-2 ring-emerald-500/20"
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <Portrait name={mechanic.fullName} imageUrl={mechanic.imageUrl} />
                <div className="min-w-0 w-full">
                  <div className="font-semibold text-slate-900 truncate">
                    {mechanic.fullName}
                  </div>
                  {mechanic.email && (
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      {mechanic.email}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
