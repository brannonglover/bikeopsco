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

export type BikeType = "REGULAR" | "E_BIKE";

export interface Bike {
  id: string;
  make: string;
  model: string;
  bikeType: BikeType | null;
  nickname: string | null;
  imageUrl: string | null;
}

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
  bikes?: Bike[];
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number | string; // Prisma Decimal can come as string
  slug?: string | null;
  isSystem?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobService {
  id: string;
  jobId: string;
  serviceId: string | null;
  service: Service | null;
  customServiceName?: string | null;
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

export interface MessageReaction {
  id: string;
  messageId: string;
  emoji: string;
  reactorType: MessageSender;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  sender: MessageSender;
  body: string | null;
  attachments: MessageAttachment[];
  reactions: MessageReaction[];
  createdAt: string;
  editedAt?: string | null;
}

export interface Conversation {
  id: string;
  customerId: string;
  jobId: string | null;
  customer: Customer;
  job?: { id: string; bikeMake: string; bikeModel: string } | null;
  messages: ChatMessage[];
  archived?: boolean;
  customerTypingAt?: string | null;
  /** ISO time when staff last loaded this thread; unread badge if last message is newer from customer. */
  staffLastReadAt?: string | null;
  /** ISO time when the customer last loaded this thread; "Viewed" indicator on staff messages. */
  customerLastReadAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobBike {
  id: string;
  jobId: string;
  make: string;
  model: string;
  bikeType: BikeType | null;
  nickname: string | null;
  imageUrl: string | null;
  bikeId: string | null;
  sortOrder: number;
  completedAt: string | null;
  waitingOnPartsAt: string | null;
  bike?: {
    imageUrl: string | null;
    bikeType: BikeType | null;
    make: string;
    model: string;
    nickname?: string | null;
  } | null;
}

export interface Job {
  id: string;
  bikeMake: string;
  bikeModel: string;
  jobBikes?: JobBike[];
  workingOnJobBikeId?: string | null;
  stage: Stage;
  deliveryType: DeliveryType;
  dropOffDate: string | null;
  pickupDate: string | null;
  collectionAddress: string | null;
  collectionWindowStart: string | null;
  collectionWindowEnd: string | null;
  customerId: string | null;
  customer: Customer | null;
  notes: string | null;
  internalNotes: string | null;
  customerNotes: string | null;
  cancellationReason?: string | null;
  completedAt: string | null;
  archivedAt?: string | null;
  paymentStatus?: PaymentStatus;
  jobServices?: JobService[];
  jobProducts?: JobProduct[];
  createdAt: string;
  updatedAt: string;
}
