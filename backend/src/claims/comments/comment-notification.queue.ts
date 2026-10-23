import { enqueueNotification } from '../../notifications/notification-jobs.queue';

/**
 * ClaimComment job: asynchronously notify the parent comment author of a reply.
 * Payload carries IDs only (no comment body) via the shared notifications queue.
 */
export async function enqueueClaimCommentReply(args: {
  parentAuthorAddress: string;
  claimId: number;
  commentId: string;
  parentId: string;
}): Promise<void> {
  await enqueueNotification({
    userId: args.parentAuthorAddress,
    notificationType: 'claim_update',
    metadata: {
      job: 'ClaimComment',
      claimId: args.claimId,
      commentId: args.commentId,
      parentId: args.parentId,
    },
  });
}
