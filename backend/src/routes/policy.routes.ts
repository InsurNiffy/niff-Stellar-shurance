import { Router } from "express";
import { listPolicies, getPolicy } from "../controllers/policy.controller";
import { publicRateLimit } from "../middleware/rateLimit";

const router = Router();

router.use(publicRateLimit);

/**
 * @openapi
 * /policies:
 *   get:
 *     summary: List policies
 *     tags: [Policies]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, expired] }
 *         description: Filter by policy status
 *       - in: query
 *         name: holder
 *         schema: { type: string }
 *         description: Filter by policyholder Stellar address
 *       - in: query
 *         name: after
 *         schema: { type: string }
 *         description: Opaque pagination cursor from previous response
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Paginated policy list
 *       400:
 *         description: Invalid filter or cursor
 *       429:
 *         description: Rate limit exceeded
 */
router.get("/", listPolicies);

/**
 * @openapi
 * /policies/{holder}/{policy_id}:
 *   get:
 *     summary: Get a single policy
 *     tags: [Policies]
 *     parameters:
 *       - in: path
 *         name: holder
 *         required: true
 *         schema: { type: string }
 *         description: URL-encoded Stellar address of the policyholder
 *       - in: path
 *         name: policy_id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *         description: Per-holder policy identifier
 *     responses:
 *       200:
 *         description: Policy detail
 *       400:
 *         description: Invalid policy_id
 *       404:
 *         description: Policy not found
 *       429:
 *         description: Rate limit exceeded
 */
router.get("/:holder/:policy_id", getPolicy);

export default router;
