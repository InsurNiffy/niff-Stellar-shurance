import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GraphQLError,
  type ArgumentNode,
  type DocumentNode,
  type FragmentDefinitionNode,
  Kind,
  type OperationDefinitionNode,
  type ValueNode,
} from 'graphql';

type Variables = Record<string, unknown>;

@Injectable()
export class GraphqlOperationGuardService {
  private readonly maxDepth: number;
  private readonly maxComplexity: number;
  private readonly defaultNestedClaimsLimit: number;

  constructor(config: ConfigService) {
    this.maxDepth = config.get<number>('GRAPHQL_MAX_DEPTH', 8);
    this.maxComplexity = config.get<number>('GRAPHQL_MAX_COMPLEXITY', 250);
    this.defaultNestedClaimsLimit = config.get<number>('GRAPHQL_POLICY_CLAIMS_DEFAULT_LIMIT', 10);
  }

  assertWithinLimits(document: DocumentNode, variables: Variables = {}): void {
    const fragments = new Map<string, FragmentDefinitionNode>();
    const operations = document.definitions.filter(
      (definition): definition is OperationDefinitionNode =>
        definition.kind === Kind.OPERATION_DEFINITION,
    );

    for (const definition of document.definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) {
        fragments.set(definition.name.value, definition);
      }
    }

    for (const operation of operations) {
      const depth = this.computeDepth(operation.selectionSet, fragments, 1);
      if (depth > this.maxDepth) {
        throw new GraphQLError(
          `GraphQL query depth ${depth} exceeds the configured limit of ${this.maxDepth}.`,
          { extensions: { code: 'GRAPHQL_DEPTH_LIMIT' } },
        );
      }

      const complexity = this.computeComplexity(operation.selectionSet, fragments, variables, 1);
      if (complexity > this.maxComplexity) {
        throw new GraphQLError(
          `GraphQL query complexity ${complexity} exceeds the configured limit of ${this.maxComplexity}.`,
          { extensions: { code: 'GRAPHQL_COMPLEXITY_LIMIT' } },
        );
      }
    }
  }

  private computeDepth(
    selectionSet: FragmentDefinitionNode['selectionSet'],
    fragments: Map<string, FragmentDefinitionNode>,
    currentDepth: number,
  ): number {
    let maxDepth = currentDepth;

    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD && selection.selectionSet) {
        maxDepth = Math.max(
          maxDepth,
          this.computeDepth(selection.selectionSet, fragments, currentDepth + 1),
        );
      }

      if (selection.kind === Kind.INLINE_FRAGMENT) {
        maxDepth = Math.max(
          maxDepth,
          this.computeDepth(selection.selectionSet, fragments, currentDepth + 1),
        );
      }

      if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const fragment = fragments.get(selection.name.value);
        if (fragment) {
          maxDepth = Math.max(
            maxDepth,
            this.computeDepth(fragment.selectionSet, fragments, currentDepth + 1),
          );
        }
      }
    }

    return maxDepth;
  }

  private computeComplexity(
    selectionSet: FragmentDefinitionNode['selectionSet'],
    fragments: Map<string, FragmentDefinitionNode>,
    variables: Variables,
    multiplier: number,
  ): number {
    let total = 0;

    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD) {
        const fieldMultiplier = this.fieldMultiplier(selection.name.value, selection.arguments ?? [], variables);
        total += multiplier;

        if (selection.selectionSet) {
          total += this.computeComplexity(
            selection.selectionSet,
            fragments,
            variables,
            multiplier * fieldMultiplier,
          );
        }
      }

      if (selection.kind === Kind.INLINE_FRAGMENT) {
        total += this.computeComplexity(selection.selectionSet, fragments, variables, multiplier);
      }

      if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const fragment = fragments.get(selection.name.value);
        if (fragment) {
          total += this.computeComplexity(fragment.selectionSet, fragments, variables, multiplier);
        }
      }
    }

    return total;
  }

  private fieldMultiplier(
    fieldName: string,
    args: readonly ArgumentNode[],
    variables: Variables,
  ): number {
    const firstArg = args.find((arg) => arg.name.value === 'first');
    const resolvedFirst = firstArg ? this.resolveNumericValue(firstArg.value, variables) : undefined;

    switch (fieldName) {
      case 'policies':
      case 'claimsNeedingMyVote':
        return this.clampPositive(resolvedFirst ?? 20, 100);
      case 'claims':
        return this.clampPositive(
          resolvedFirst ?? this.defaultNestedClaimsLimit,
          100,
        );
      case 'adminPolicies':
        return this.clampPositive(resolvedFirst ?? 20, 100);
      default:
        return 1;
    }
  }

  private resolveNumericValue(value: ValueNode, variables: Variables): number | undefined {
    if (value.kind === Kind.INT) {
      return Number(value.value);
    }

    if (value.kind === Kind.VARIABLE) {
      const resolved = variables[value.name.value];
      return typeof resolved === 'number' ? resolved : undefined;
    }

    return undefined;
  }

  private clampPositive(value: number, max: number): number {
    if (!Number.isFinite(value) || value < 1) {
      return 1;
    }

    return Math.min(value, max);
  }
}
