export type Stage =
  | "PENDING_APPROVAL"
  | "BOOKED_IN"
  | "RECEIVED"
  | "WORKING_ON"
  | "WAITING_ON_PARTS"
  | "BIKE_READY"
  | "COMPLETED"
  | "CANCELLED";

export type DeliveryType = "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE";

export interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number | string; // Prisma Decimal can come as string
  createdAt: string;
  updatedAt: string;
}

export interface JobService {
  id: string;
  jobId: string;
  serviceId: string;
  service: Service;
  quantity: number;
  unitPrice: number | string;
  notes: string | null;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
}

export interface JobProduct {
  id: string;
  jobId: string;
  productId: string;
  product: Product;
  quantity: number;
  unitPrice: number | string;
  notes: string | null;
}

export type PaymentStatus = "UNPAID" | "PENDING" | "PAID" | "REFUNDED";

export type MessageSender = "STAFF" | "CUSTOMER";

export interface MessageAttachment {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  sender: MessageSender;
  body: string | null;
  attachments: MessageAttachment[];
  createdAt: string;
}

export interface Conversation {
  id: string;
  customerId: string;
  jobId: string | null;
  customer: Customer;
  job?: { id: string; bikeMake: string; bikeModel: string } | null;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  bikeMake: string;
  bikeModel: string;
  stage: Stage;
  deliveryType: DeliveryType;
  dropOffDate: string | null;
  pickupDate: string | null;
  collectionAddress: string | null;
  customerId: string | null;
  customer: Customer | null;
  notes: string | null;
  internalNotes: string | null;
  customerNotes: string | null;
  cancellationReason?: string | null;
  completedAt: string | null;
  paymentStatus?: PaymentStatus;
  jobServices?: JobService[];
  jobProducts?: JobProduct[];
  createdAt: string;
  updatedAt: string;
}
