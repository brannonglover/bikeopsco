import type { Job, JobProduct, JobService } from "@/lib/types";

const isIncompleteServiceLine = (js: JobService) =>
  !js.id ||
  (Boolean(js.serviceId) && !js.service) ||
  (!js.serviceId && !js.customServiceName && !js.service);

const isIncompleteProductLine = (jp: JobProduct) =>
  !jp.id || !jp.productId || !jp.product;

/**
 * Merge board/modal job payloads without clobbering invoice lines when a lightweight
 * board row is missing nested service/product relations.
 */
export function mergeJobPreservingInvoiceDetails(prev: Job, next: Job): Job {
  const merged = { ...prev, ...next };
  const nextServices = next.jobServices ?? [];
  const nextProducts = next.jobProducts ?? [];

  if (nextServices.length > 0 && nextServices.some(isIncompleteServiceLine)) {
    merged.jobServices = prev.jobServices;
  }
  if (nextProducts.length > 0 && nextProducts.some(isIncompleteProductLine)) {
    merged.jobProducts = prev.jobProducts;
  }

  return merged;
}

export function applyJobProductLineUpdate(job: Job, line: JobProduct): Job {
  return {
    ...job,
    jobProducts: (job.jobProducts ?? []).map((jp) =>
      jp.id === line.id ? { ...jp, ...line } : jp
    ),
  };
}

export function applyJobServiceLineUpdate(job: Job, line: JobService): Job {
  return {
    ...job,
    jobServices: (job.jobServices ?? []).map((js) =>
      js.id === line.id ? { ...js, ...line } : js
    ),
  };
}
