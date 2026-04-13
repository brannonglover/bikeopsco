"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useForm, useController, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import type { Job } from "@/lib/types";
import { Price } from "@/components/ui/Price";

interface JobFormProps {
  onSuccess?: (job: Job) => void;
  embedded?: boolean;
}

const bikeSchema = z.object({
  make: z.string(),
  model: z.string().optional().nullable(),
  nickname: z.string().optional(),
  bikeId: z.string().optional(),
  imageUrl: z.string().optional().nullable(),
  bikeType: z.enum(["AUTO", "REGULAR", "E_BIKE"]),
});

const schema = z.object({
  bikes: z.array(bikeSchema).min(1, "At least one bike is required"),
  customerId: z.string().optional(),
  deliveryType: z.enum(["DROP_OFF_AT_SHOP", "COLLECTION_SERVICE"]),
  dropOffDate: z.string().optional(),
  pickupDate: z.string().optional(),
  collectionAddress: z.string().optional(),
  collectionWindowStart: z.string().optional(),
  collectionWindowEnd: z.string().optional(),
  internalNotes: z.string().optional(),
  customerNotes: z.string().optional(),
  serviceIds: z.array(z.string()).optional(),
}).refine((data) => data.bikes.some((b) => b.make?.trim()), {
  message: "At least one bike must have a make",
  path: ["bikes"],
});

type FormData = z.infer<typeof schema>;
type BikeFormRow = z.infer<typeof bikeSchema>;

function normalizeJobFormBikeType(
  value: string | null | undefined
): BikeFormRow["bikeType"] {
  if (value === "REGULAR" || value === "E_BIKE" || value === "AUTO") {
    return value;
  }
  return "AUTO";
}

function getDefaultDropOffDateTime(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T09:00`;
}

interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

interface Bike {
  id: string;
  make: string;
  model: string;
  nickname: string | null;
  imageUrl?: string | null;
  bikeType?: "REGULAR" | "E_BIKE" | null;
}

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  isSystem?: boolean;
}

export function JobForm({ onSuccess, embedded }: JobFormProps) {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [customerInput, setCustomerInput] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [customerBikes, setCustomerBikes] = useState<Bike[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  /** Prevents double submit before RHF sets isSubmitting (e.g. double tap / rapid clicks). */
  const jobCreateLockRef = useRef(false);

  const {
    register,
    handleSubmit,
    watch,
    control,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      bikes: [{ make: "", model: "", bikeType: "AUTO" }],
      deliveryType: "DROP_OFF_AT_SHOP",
      dropOffDate: getDefaultDropOffDateTime(),
    },
  });

  const { field: customerIdField } = useController({
    name: "customerId",
    control,
    defaultValue: "",
  });

  const { fields, append, remove, update } = useFieldArray({
    control,
    name: "bikes",
  });

  const deliveryType = watch("deliveryType");
  const customerId = watch("customerId");
  const selectedCustomer = customers.find((c) => c.id === customerId);
  const customerDisplayName = (c: Customer) =>
    c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName;
  const exactMatch = customers.find(
    (c) =>
      customerDisplayName(c).toLowerCase() ===
      customerInput.trim().toLowerCase()
  );
  const showCreateOption =
    customerInput.trim().length > 0 && !exactMatch && !selectedCustomer;

  /** Load saved bikes when a customer is selected or when the typed name exactly matches a search result (dropdown click not required). */
  const resolvedCustomerIdForBikes = useMemo(
    () => exactMatch?.id ?? customerId ?? null,
    [exactMatch, customerId]
  );

  const staffSelectableServices = useMemo(
    () => services.filter((s) => !s.isSystem),
    [services]
  );

  const filteredServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return staffSelectableServices;
    return staffSelectableServices.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q))
    );
  }, [staffSelectableServices, serviceSearch]);

  const searchCustomers = useCallback((q: string) => {
    setIsSearching(true);
    fetch(`/api/customers?q=${encodeURIComponent(q)}`)
      .then((res) => res.json())
      .then((data) => setCustomers(Array.isArray(data) ? data : []))
      .finally(() => setIsSearching(false));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchCustomers(customerInput), 200);
    return () => clearTimeout(timer);
  }, [customerInput, searchCustomers]);

  useEffect(() => {
    if (resolvedCustomerIdForBikes) {
      fetch(`/api/customers/${resolvedCustomerIdForBikes}/bikes`)
        .then((res) => res.json())
        .then((data) => setCustomerBikes(Array.isArray(data) ? data : []));
    } else {
      setCustomerBikes([]);
    }
  }, [resolvedCustomerIdForBikes]);

  useEffect(() => {
    fetch("/api/services")
      .then((res) => res.json())
      .then((data) => setServices(Array.isArray(data) ? data : []));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectCustomer = (customer: Customer) => {
    customerIdField.onChange(customer.id);
    setCustomerInput(customerDisplayName(customer));
    setShowDropdown(false);
  };

  const createAndSelectCustomer = async () => {
    const input = customerInput.trim();
    if (!input) return;
    const parts = input.split(/\s+/);
    const firstName = parts[0] ?? input;
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
    setIsCreating(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName }),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = "Failed to create customer";
        if (text) {
          try {
            const err = JSON.parse(text);
            msg = typeof err.error === "string" ? err.error : err.error?.message || msg;
          } catch {
            msg = text.slice(0, 100);
          }
        }
        alert(msg);
        return;
      }
      const created = await res.json();
      selectCustomer(created);
      setCustomers((prev) => [created, ...prev]);
    } finally {
      setIsCreating(false);
    }
  };

  const clearCustomer = () => {
    customerIdField.onChange("");
    setCustomerInput("");
    setShowDropdown(true);
  };

  const onSubmit = async (data: FormData) => {
    if (jobCreateLockRef.current) return;
    jobCreateLockRef.current = true;
    try {
    let finalCustomerId = data.customerId;

    if (!finalCustomerId && customerInput.trim()) {
      const input = customerInput.trim();
      const match = customers.find(
        (c) => customerDisplayName(c).toLowerCase() === input.toLowerCase()
      );
      if (match) {
        finalCustomerId = match.id;
      } else {
        const parts = input.split(/\s+/);
        const firstName = parts[0] ?? input;
        const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
        const customerRes = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ firstName, lastName }),
        });
        if (!customerRes.ok) {
          const text = await customerRes.text();
          let msg = "Failed to create customer";
          if (text) {
            try {
              const err = JSON.parse(text);
              msg = typeof err.error === "string" ? err.error : err.error?.message || msg;
            } catch {
              msg = text.slice(0, 100);
            }
          }
          alert(msg);
          return;
        }
        const created = await customerRes.json();
        finalCustomerId = created.id;
      }
    }

    const validBikes = data.bikes.filter((b) => b.make?.trim());
    const bikeMake = validBikes.length === 1 ? validBikes[0].make : "Multiple";
    const bikeModel = validBikes.length === 1 ? (validBikes[0].model ?? "") : `${validBikes.length} bikes`;

    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bikeMake,
        bikeModel,
        bikes: validBikes.map((b) => ({
          make: b.make,
          model: b.model,
          nickname: b.nickname || null,
          imageUrl: b.imageUrl || null,
          bikeId: b.bikeId || null,
          bikeType: b.bikeType === "AUTO" ? undefined : b.bikeType,
        })),
        customerId: finalCustomerId || null,
        deliveryType: data.deliveryType,
        dropOffDate: data.dropOffDate || null,
        pickupDate: data.pickupDate || null,
        collectionAddress:
          data.deliveryType === "COLLECTION_SERVICE"
            ? data.collectionAddress || selectedCustomer?.address || null
            : null,
        collectionWindowStart:
          data.deliveryType === "COLLECTION_SERVICE"
            ? data.collectionWindowStart || null
            : null,
        collectionWindowEnd:
          data.deliveryType === "COLLECTION_SERVICE"
            ? data.collectionWindowEnd || null
            : null,
        internalNotes: data.internalNotes || null,
        customerNotes: data.customerNotes || null,
        serviceIds: selectedServiceIds,
      }),
    });

    if (res.ok) {
      const job = (await res.json()) as Job;
      if (onSuccess) {
        onSuccess(job);
      } else {
        router.push("/calendar");
      }
    } else {
      let message = "Failed to create job";
      try {
        const text = await res.text();
        if (text) {
          const err = JSON.parse(text);
          message =
            typeof err.error === "string"
              ? err.error
              : err.error?.message || message;
        }
      } catch {
        // Response wasn't valid JSON, use default message
      }
      alert(message);
    }
    } finally {
      jobCreateLockRef.current = false;
    }
  };

  return (
    <div className={`w-full min-w-0 max-w-full ${embedded ? "max-w-xl" : "max-w-xl"}`}>
      {!embedded && (
        <h1 className="text-2xl font-bold text-slate-900 mb-6">Create Job</h1>
      )}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 min-w-0">
        <div className="relative min-w-0" ref={dropdownRef}>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Customer
          </label>
          <div className="relative">
            <input
              type="text"
              value={customerInput}
              onChange={(e) => {
                setCustomerInput(e.target.value);
                setShowDropdown(true);
                if (!e.target.value) customerIdField.onChange("");
              }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Type name to search or create..."
              className="w-full min-w-0 px-4 py-2 pr-16 sm:pr-20 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
            />
            {selectedCustomer && (
              <button
                type="button"
                onClick={clearCustomer}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
                aria-label="Clear customer"
              >
                Clear
              </button>
            )}
          </div>
          {showDropdown && (customerInput.length > 0 || customers.length > 0) && (
            <div className="absolute z-10 mt-1 left-0 right-0 min-w-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto overflow-x-hidden">
              {isSearching ? (
                <div className="px-4 py-3 text-sm text-slate-500">Searching...</div>
              ) : customers.length === 0 && !showCreateOption ? (
                <div className="px-4 py-3 text-sm text-slate-500">No customers found</div>
              ) : (
                <>
                  {customers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="w-full px-4 py-2 text-left hover:bg-slate-50 text-sm flex flex-col"
                    >
                      <span className="font-medium">{customerDisplayName(c)}</span>
                      {c.email && (
                        <span className="text-slate-500 text-xs">{c.email}</span>
                      )}
                    </button>
                  ))}
                  {showCreateOption && (
                    <button
                      type="button"
                      onClick={createAndSelectCustomer}
                      disabled={isCreating}
                      className="w-full px-4 py-2 text-left hover:bg-emerald-50 text-emerald-700 font-medium text-sm border-t border-slate-100"
                    >
                      {isCreating
                        ? "Creating..."
                        : `+ Create "${customerInput.trim()}"`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <label className="block text-sm font-medium text-slate-700">
              Bikes
            </label>
            <div className="flex gap-2">
              {customerBikes.length > 0 && (
                <select
                  onChange={(e) => {
                    const val = e.target.value;
                    e.target.value = "";
                    if (!val) return;
                    const bike = customerBikes.find((b) => b.id === val);
                    if (bike) {
                      const payload: BikeFormRow = {
                        make: bike.make,
                        model: bike.model,
                        nickname: bike.nickname ?? undefined,
                        bikeId: bike.id,
                        imageUrl: bike.imageUrl ?? undefined,
                        bikeType: normalizeJobFormBikeType(bike.bikeType),
                      };
                      const first = getValues("bikes.0");
                      const firstEmpty =
                        !first?.make?.trim() && !first?.model?.trim();
                      if (firstEmpty) {
                        update(0, payload);
                      } else {
                        append(payload);
                      }
                    }
                  }}
                  className="text-sm px-3 py-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50"
                >
                  <option value="">+ Add saved bike</option>
                  {customerBikes.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nickname ? `${b.nickname} (${[b.make, b.model].filter(Boolean).join(" ")})` : [b.make, b.model].filter(Boolean).join(" ")}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => append({ make: "", model: "", bikeType: "AUTO" })}
                className="text-sm px-3 py-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 font-medium"
              >
                + Add bike
              </button>
            </div>
          </div>
          <div className="space-y-4">
            {fields.map((field, i) => (
              <div
                key={field.id}
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-600">Bike {i + 1}</span>
                  {fields.length > 1 && (
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="text-slate-400 hover:text-red-600 text-sm"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Make</label>
                    <input
                      {...register(`bikes.${i}.make`)}
                      placeholder="e.g. Trek, Specialized"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                    {errors.bikes?.[i]?.make && (
                      <p className="text-red-600 text-xs mt-1">{errors.bikes[i]?.make?.message}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Model (optional)</label>
                    <input
                      {...register(`bikes.${i}.model`)}
                      placeholder="e.g. Domane SL 6"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                    {errors.bikes?.[i]?.model && (
                      <p className="text-red-600 text-xs mt-1">{errors.bikes[i]?.model?.message}</p>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Bike type</label>
                  <select
                    {...register(`bikes.${i}.bikeType`)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none bg-white"
                  >
                    <option value="AUTO">Auto (from make/model)</option>
                    <option value="REGULAR">Standard bike</option>
                    <option value="E_BIKE">E-bike</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Nickname (optional)</label>
                  <input
                    {...register(`bikes.${i}.nickname`)}
                    placeholder="e.g. Road bike, Commuter"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>
            ))}
          </div>
          {errors.bikes?.root && (
            <p className="text-red-600 text-sm mt-1">{errors.bikes.root.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Services
          </label>
          <p className="text-xs text-slate-500 mb-2">
            Select the services being done on this bike
          </p>
          {services.length === 0 ? (
            <p className="text-sm text-slate-500 py-2">
              No services defined yet.{" "}
              <a href="/settings/services" className="text-indigo-600 hover:underline">
                Add services
              </a>{" "}
              first.
            </p>
          ) : (
            <>
              <input
                type="text"
                value={serviceSearch}
                onChange={(e) => setServiceSearch(e.target.value)}
                placeholder="Search services..."
                className="w-full min-w-0 px-3 py-2 mb-2 border border-slate-200 rounded-xl text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-transparent"
              />
              <div className="border border-slate-200 rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                {filteredServices.map((s) => {
                  const price = typeof s.price === "string" ? parseFloat(s.price) : Number(s.price);
                  const isSelected = selectedServiceIds.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className="flex items-center gap-3 p-2 rounded hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedServiceIds((prev) => [...prev, s.id]);
                          } else {
                            setSelectedServiceIds((prev) => prev.filter((id) => id !== s.id));
                          }
                        }}
                        className="rounded-lg border-slate-200 text-indigo-600 focus:ring-indigo-500/20"
                      />
                      <span className="flex-1 font-medium text-slate-800">{s.name}</span>
                      <Price amount={price} variant="inline" />
                    </label>
                  );
                })}
              </div>
              {serviceSearch.trim() && filteredServices.length === 0 && (
                <p className="text-sm text-slate-500 mt-2">No services match your search</p>
              )}
            </>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Delivery Type
          </label>
          <select
            {...register("deliveryType")}
            className="w-full min-w-0 px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="DROP_OFF_AT_SHOP">Drop-off at shop</option>
            <option value="COLLECTION_SERVICE">Collection service</option>
          </select>
        </div>

        {deliveryType === "COLLECTION_SERVICE" && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Collection Address (if different from customer)
            </label>
            <input
              {...register("collectionAddress")}
              className="w-full min-w-0 px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20"
              placeholder={selectedCustomer?.address || "Pickup/delivery address"}
            />
            <p className="text-xs text-slate-500 mt-2">
              Pickup/dropoff within 5 miles: $20 standard bike, $30 e-bike. The matching line is added to the job automatically (use bike type above or leave Auto to detect from make/model).
            </p>
            <div className="mt-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Collection Window
              </label>
              <p className="text-xs text-slate-500 mb-2">
                Time window when you plan to collect the bike
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
                  <input
                    {...register("collectionWindowStart")}
                    type="time"
                    className="w-full min-w-0 px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
                  <input
                    {...register("collectionWindowEnd")}
                    type="time"
                    className="w-full min-w-0 px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="min-w-0">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {deliveryType === "COLLECTION_SERVICE" ? "Collection Pickup" : "Drop-off Date"}
            </label>
            <input
              {...register("dropOffDate")}
              type="datetime-local"
              className="w-full max-w-full min-w-0 px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 box-border"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {deliveryType === "COLLECTION_SERVICE" ? "Collection Return" : "Pickup Date"}
            </label>
            <input
              {...register("pickupDate")}
              type="datetime-local"
              className="w-full max-w-full min-w-0 px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 box-border"
            />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Internal Notes
            </label>
            <p className="text-xs text-slate-500 mb-1">For staff only — not shared with customer</p>
            <textarea
              {...register("internalNotes")}
              rows={3}
              className="w-full min-w-0 px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 resize-y"
              placeholder="Repair notes, issues found, cost estimates..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Notes for Customer
            </label>
            <p className="text-xs text-slate-500 mb-1">Shared with customer via email or in updates</p>
            <textarea
              {...register("customerNotes")}
              rows={3}
              className="w-full min-w-0 px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 resize-y"
              placeholder="Updates, instructions, or messages for the customer..."
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {isSubmitting ? "Creating..." : "Create Job"}
        </button>
      </form>
    </div>
  );
}
