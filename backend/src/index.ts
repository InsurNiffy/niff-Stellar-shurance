import express from "express";

import { NotificationJobsService } from "./jobs/notification-jobs.service";
import { InMemoryNotificationDispatcher } from "./notifications/notification-dispatcher";
import {
  InMemoryNotificationPreferencesRepository,
} from "./notifications/notification-preferences.repository";
import { createNotificationsRouter } from "./notifications/notifications.controller";
import { NotificationsService } from "./notifications/notifications.service";

const app = express();
app.use(express.json());

const preferencesRepository = new InMemoryNotificationPreferencesRepository();
const notificationsService = new NotificationsService(preferencesRepository);
const notificationDispatcher = new InMemoryNotificationDispatcher();

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/notifications", createNotificationsRouter(notificationsService));

export const notificationJobsService = new NotificationJobsService(
  notificationsService,
  notificationDispatcher,
);
export const notificationDispatchLog = notificationDispatcher.sent;

export default app;
