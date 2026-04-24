const { InMemoryNotificationPreferencesRepository } = require("../dist/notifications/notification-preferences.repository");
const { NotificationsService } = require("../dist/notifications/notifications.service");
const { InMemoryNotificationDispatcher } = require("../dist/notifications/notification-dispatcher");
const { NotificationJobsService } = require("../dist/jobs/notification-jobs.service");
const { ConfigService } = require("@nestjs/config");

function createNotificationsService(repository) {
  return new NotificationsService(new ConfigService(), repository);
}

describe("NotificationsService", () => {
  it("applies defaults when a user has no row", async () => {
    const repository = new InMemoryNotificationPreferencesRepository();
    const service = createNotificationsService(repository);

    await expect(service.getUserNotificationPreferences("user-1")).resolves.toEqual({
      renewalRemindersEnabled: true,
      claimUpdatesEnabled: true,
    });
  });

  it("treats null database values as unset and falls back to defaults", async () => {
    const repository = new InMemoryNotificationPreferencesRepository();
    await repository.upsert({
      userId: "user-2",
      renewalRemindersEnabled: null,
      claimUpdatesEnabled: false,
    });
    const service = createNotificationsService(repository);

    await expect(service.getUserNotificationPreferences("user-2")).resolves.toEqual({
      renewalRemindersEnabled: true,
      claimUpdatesEnabled: false,
    });
  });

  it("merges partial updates without dropping untouched preferences", async () => {
    const repository = new InMemoryNotificationPreferencesRepository();
    const service = createNotificationsService(repository);

    await service.updateUserNotificationPreferences("user-3", {
      claimUpdatesEnabled: false,
    });

    await expect(service.getUserNotificationPreferences("user-3")).resolves.toEqual({
      renewalRemindersEnabled: true,
      claimUpdatesEnabled: false,
    });
  });
});

describe("NotificationJobsService", () => {
  it("blocks renewal reminders when the preference is disabled", async () => {
    const repository = new InMemoryNotificationPreferencesRepository();
    const notificationsService = createNotificationsService(repository);
    const dispatcher = new InMemoryNotificationDispatcher();
    const jobsService = new NotificationJobsService(
      notificationsService,
      dispatcher,
    );

    await notificationsService.updateUserNotificationPreferences("user-4", {
      renewalRemindersEnabled: false,
    });

    await expect(
      jobsService.sendRenewalReminder({
        userId: "user-4",
        policyId: "POL-001",
      }),
    ).resolves.toEqual({
      delivered: false,
      reason: "preference_disabled",
    });
    expect(dispatcher.sent).toEqual([]);
  });

  it("sends claim updates when the preference is enabled", async () => {
    const repository = new InMemoryNotificationPreferencesRepository();
    const notificationsService = createNotificationsService(repository);
    const dispatcher = new InMemoryNotificationDispatcher();
    const jobsService = new NotificationJobsService(
      notificationsService,
      dispatcher,
    );

    await expect(
      jobsService.sendClaimUpdate({
        userId: "user-5",
        claimId: "CLM-001",
        status: "approved",
      }),
    ).resolves.toEqual({
      delivered: true,
    });
    expect(dispatcher.sent).toEqual([
      {
        userId: "user-5",
        notificationType: "claim_update",
        message: "Claim CLM-001 status changed to approved.",
      },
    ]);
  });
});
