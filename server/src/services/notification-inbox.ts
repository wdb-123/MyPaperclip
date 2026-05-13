import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { notificationInboxItems } from "@paperclipai/db";

export type NotificationInboxStatus = "unread" | "read" | "handled" | "dismissed";

type ListNotificationInboxItemsInput = {
  recipientType?: string;
  recipientId?: string;
  status?: NotificationInboxStatus;
};

export function notificationInboxService(db: Db) {
  return {
    list(companyId: string, input: ListNotificationInboxItemsInput = {}) {
      const conditions = [eq(notificationInboxItems.companyId, companyId)];
      if (input.recipientType) conditions.push(eq(notificationInboxItems.recipientType, input.recipientType));
      if (input.recipientId) conditions.push(eq(notificationInboxItems.recipientId, input.recipientId));
      if (input.status) conditions.push(eq(notificationInboxItems.status, input.status));
      return db
        .select()
        .from(notificationInboxItems)
        .where(and(...conditions))
        .orderBy(desc(notificationInboxItems.updatedAt), desc(notificationInboxItems.createdAt));
    },

    async markRead(companyId: string, itemId: string, now: Date = new Date()) {
      const [row] = await db
        .update(notificationInboxItems)
        .set({
          status: "read",
          readAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(notificationInboxItems.id, itemId),
          eq(notificationInboxItems.companyId, companyId),
          eq(notificationInboxItems.status, "unread"),
        ))
        .returning();
      if (row) return row;
      const [existing] = await db
        .select()
        .from(notificationInboxItems)
        .where(and(eq(notificationInboxItems.id, itemId), eq(notificationInboxItems.companyId, companyId)))
        .limit(1);
      return existing ?? null;
    },

    async markHandled(companyId: string, itemId: string, now: Date = new Date()) {
      const [row] = await db
        .update(notificationInboxItems)
        .set({
          status: "handled",
          readAt: now,
          handledAt: now,
          updatedAt: now,
        })
        .where(and(eq(notificationInboxItems.id, itemId), eq(notificationInboxItems.companyId, companyId)))
        .returning();
      return row ?? null;
    },
  };
}
