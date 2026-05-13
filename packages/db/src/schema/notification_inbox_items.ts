import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, boolean } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const notificationInboxItems = pgTable(
  "notification_inbox_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    recipientType: text("recipient_type").notNull(),
    recipientId: text("recipient_id").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    sourceKey: text("source_key").notNull(),
    actionKey: text("action_key").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    status: text("status").notNull().default("unread"),
    requiresAction: boolean("requires_action").notNull().default(false),
    deliveryChannels: jsonb("delivery_channels").$type<string[]>().notNull().default([]),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    recipientStatusIdx: index("notification_inbox_items_recipient_status_idx").on(
      table.companyId,
      table.recipientType,
      table.recipientId,
      table.status,
    ),
    subjectIdx: index("notification_inbox_items_subject_idx").on(
      table.companyId,
      table.subjectType,
      table.subjectId,
    ),
    sourceUniqueIdx: uniqueIndex("notification_inbox_items_source_key_idx").on(table.companyId, table.sourceKey),
  }),
);
