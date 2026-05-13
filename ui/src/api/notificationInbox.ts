import { api } from "./client";

export type NotificationInboxStatus = "unread" | "read" | "handled" | "dismissed";
export type NotificationInboxRecipientType = "user" | "agent" | "position";

export interface NotificationInboxItem {
  id: string;
  companyId: string;
  recipientType: NotificationInboxRecipientType;
  recipientId: string;
  subjectType: string;
  subjectId: string;
  sourceKey: string;
  actionKey: string;
  title: string;
  body: string | null;
  status: NotificationInboxStatus;
  requiresAction: boolean;
  deliveryChannels: string[];
  deliveredAt: string | null;
  readAt: string | null;
  handledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const notificationInboxApi = {
  list: (
    companyId: string,
    filters?: {
      recipientType?: NotificationInboxRecipientType;
      recipientId?: string;
      status?: NotificationInboxStatus;
    },
  ) => {
    const params = new URLSearchParams();
    if (filters?.recipientType) params.set("recipientType", filters.recipientType);
    if (filters?.recipientId) params.set("recipientId", filters.recipientId);
    if (filters?.status) params.set("status", filters.status);
    const qs = params.toString();
    return api.get<NotificationInboxItem[]>(`/companies/${companyId}/notification-inbox${qs ? `?${qs}` : ""}`);
  },
  markRead: (companyId: string, itemId: string) =>
    api.post<NotificationInboxItem>(`/notification-inbox-items/${itemId}/read`, { companyId }),
  markHandled: (companyId: string, itemId: string) =>
    api.post<NotificationInboxItem>(`/notification-inbox-items/${itemId}/handle`, { companyId }),
};
