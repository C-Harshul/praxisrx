export type Subscription = {
  status: "subscribed" | "unsubscribed" | "suppressed";
  version: number;
  updated_at: string;
  reason: string | null;
};
export type EmailSafeContent = {
  schema_version: "email-safe.v1";
  subject: string;
  intro: string;
  articles: {
    title: string;
    summary: string;
    body: string;
    article_url: string;
    sources: { number: number; title: string; url: string }[];
  }[];
  preferences_url: string;
  unsubscribe_url: string;
  sender_name: "MSL Evidence Briefing";
};
export type EmailRender = {
  subject: string;
  html: string;
  text: string;
  version: "email-render.v1";
};
export type DeliveryStatus =
  | "queued"
  | "sending"
  | "provider-accepted"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed"
  | "unknown"
  | "cancelled"
  | "held"
  | "preview";
export type DeliveryAttempt = {
  id: string;
  at: number;
  outcome: DeliveryStatus;
  error: string | null;
  provider_id: string | null;
  subscription_version: number;
  recipient_version: string;
};
export type DeliveryTask = {
  recipient_fingerprint: string;
  sender_fingerprint: string;
  id: string;
  newsletter_id: string;
  generation_id: string;
  recipient_id: string;
  recipient_version: string;
  idempotency_key: string;
  message_id: string;
  status: DeliveryStatus;
  attempts: DeliveryAttempt[];
  lease: string | null;
  lease_until: number;
  next_attempt_at: number;
  send_not_before?: number;
  created_at: number;
  provider_id: string | null;
  error: string | null;
  render: EmailRender;
  render_hash: string;
  reconciliation_count: number;
  events: { id: string; hash: string; type: string; at: number; evidence: string }[];
};
export type DeliveryState = {
  recipient?: {
    schema_version: "email-recipient.v1";
    id: string;
    version: string;
    address_hash: string;
    email: string;
    status: "verified" | "revoked";
    verified_at: string;
    authorized_at: string;
    modes: ("test" | "live")[];
  };
  schema_version: "email-delivery.v1";
  subscription: Subscription;
  tasks: DeliveryTask[];
};
