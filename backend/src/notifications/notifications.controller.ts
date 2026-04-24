import { Request, Response, Router } from "express";

import { NotificationPreferenceKey } from "./notification-preference.types";
import { NotificationsService } from "./notifications.service";

const ALLOWED_PREFERENCE_KEYS: NotificationPreferenceKey[] = [
  "renewalRemindersEnabled",
  "claimUpdatesEnabled",
];

function readUserIdParam(input: string | string[]): string {
  return Array.isArray(input) ? input[0] : input;
}

function parseBoolean(input: unknown): boolean | undefined {
  if (typeof input === "boolean") {
    return input;
  }

  return undefined;
}

export function createNotificationsRouter(
  notificationsService: NotificationsService,
): Router {
  const router = Router();

  router.get("/users/:userId/preferences", async (req: Request, res: Response) => {
    const userId = readUserIdParam(req.params.userId);
    const preferences = await notificationsService.getPreferences(userId);
    res.json({ userId, preferences });
  });

  router.put("/users/:userId/preferences", async (req: Request, res: Response) => {
    const userId = readUserIdParam(req.params.userId);
    const unknownFields = Object.keys(req.body ?? {}).filter(
      (key) => !ALLOWED_PREFERENCE_KEYS.includes(key as NotificationPreferenceKey),
    );

    if (unknownFields.length > 0) {
      res.status(400).json({
        error: `unknown notification preference fields: ${unknownFields.join(", ")}`,
      });
      return;
    }

    const updates = {
      renewalRemindersEnabled: parseBoolean(req.body?.renewalRemindersEnabled),
      claimUpdatesEnabled: parseBoolean(req.body?.claimUpdatesEnabled),
    };

    const hasInvalidValue = Object.entries(req.body ?? {}).some(
      ([key, value]) =>
        ALLOWED_PREFERENCE_KEYS.includes(key as NotificationPreferenceKey) &&
        typeof value !== "boolean",
    );

    if (hasInvalidValue) {
      res.status(400).json({
        error:
          "notification preferences must be boolean values when provided",
      });
      return;
    }

    const preferences = await notificationsService.updatePreferences(userId, updates);

    res.json({ userId, preferences });
  });

  return router;
}
