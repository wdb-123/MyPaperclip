import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity, notificationInboxService } from "../services/index.js";

const inboxQuerySchema = z.object({
  recipientType: z.enum(["user", "agent", "position"]).optional(),
  recipientId: z.string().trim().min(1).optional(),
  status: z.enum(["unread", "read", "handled", "dismissed"]).optional(),
});

const inboxItemActionSchema = z.object({
  companyId: z.string().uuid(),
});

export function notificationInboxRoutes(db: Db) {
  const router = Router();
  const svc = notificationInboxService(db);

  router.get("/companies/:companyId/notification-inbox", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const query = inboxQuerySchema.parse(req.query);
    const items = await svc.list(companyId, query);
    res.json(items);
  });

  router.post("/notification-inbox-items/:itemId/read", validate(inboxItemActionSchema), async (req, res) => {
    const companyId = req.body.companyId as string;
    const itemId = req.params.itemId as string;
    assertCompanyAccess(req, companyId);
    const item = await svc.markRead(companyId, itemId);
    if (!item) {
      res.status(404).json({ error: "Inbox item not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "notification.read",
      entityType: "notification_inbox_item",
      entityId: item.id,
      details: { recipientType: item.recipientType, recipientId: item.recipientId },
    });
    res.json(item);
  });

  router.post("/notification-inbox-items/:itemId/handle", validate(inboxItemActionSchema), async (req, res) => {
    const companyId = req.body.companyId as string;
    const itemId = req.params.itemId as string;
    assertCompanyAccess(req, companyId);
    const item = await svc.markHandled(companyId, itemId);
    if (!item) {
      res.status(404).json({ error: "Inbox item not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "notification.handled",
      entityType: "notification_inbox_item",
      entityId: item.id,
      details: { recipientType: item.recipientType, recipientId: item.recipientId },
    });
    res.json(item);
  });

  return router;
}
