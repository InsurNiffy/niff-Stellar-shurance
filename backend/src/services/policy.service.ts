/**
 * Policy service — orchestrates repository + pagination + DTO mapping.
 * Controllers call this; no data-access logic lives in controllers.
 */

import { toPolicyDto, PolicyDto, PolicyListDto } from "../dto/policy.dto";
import { paginate, PageParams, CursorError } from "../helpers/pagination";
import {
  listPolicies,
  getPolicy,
  PolicyFilter,
} from "../repositories/policy.repository";

export { CursorError };

export function getPoliciesList(
  filter: PolicyFilter,
  pageParams: PageParams
): PolicyListDto {
  // Full filtered list (sorted by global_seq ASC) — pagination applied after
  const all = listPolicies(filter);

  // paginate() throws CursorError on invalid cursor — controller catches it
  const page = paginate(
    all.map((r) => ({ ...r.policy, _claims: r.claims })),
    pageParams
  );

  return {
    data: page.data.map((item) => {
      const { _claims, ...policy } = item as typeof item & {
        _claims: ReturnType<typeof listPolicies>[number]["claims"];
      };
      return toPolicyDto(policy, _claims);
    }),
    next_cursor: page.next_cursor,
    total: page.total,
  };
}

export function getPolicySingle(
  holder: string,
  policy_id: number
): PolicyDto | null {
  const result = getPolicy(holder, policy_id);
  if (!result) return null;
  return toPolicyDto(result.policy, result.claims);
}
